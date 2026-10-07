// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { defineAgentWebConfig } from '../../src/application/agent-config-validation.js';
import { DEFAULT_AGENT_CONFIG } from '../../src/application/agent-config.js';
import { createWebModelRuntime } from '../../src/node/agent-base/model-runtime.js';
import { WEB_AGENT_CONFIG_CODEC } from '../../src/node/agent-base/config.js';
import { providerConfig } from '../support/agent-config.js';
import { sameAgentConfig } from '../../src/application/agent-config-equality.js';

describe('per-Agent model configuration boundary', () => {
  it('compares draft values independently of adapter key ordering', () => {
    const source = providerConfig('http://127.0.0.1:1/v1');
    if (source.model.kind !== 'provider') throw new Error('Fixture binding');
    const reordered = {
      ...source,
      model: {
        config: source.model.config,
        credential: source.model.credential,
        kind: source.model.kind,
      },
    };
    expect(sameAgentConfig(source, reordered)).toBe(true);
    expect(sameAgentConfig(source, { ...reordered, instructions: 'Different' })).toBe(false);
  });
  it('round trips capability, invocation and independent deadlines without credentials', () => {
    const config = providerConfig('http://127.0.0.1:1/v1');
    expect(WEB_AGENT_CONFIG_CODEC.decode(WEB_AGENT_CONFIG_CODEC.encode(config))).toEqual(config);
    expect(createWebModelRuntime(config, {}).provider?.inspect()).toMatchObject({
      supportsReasoning: true,
      compatibility: { supportsDeveloperRole: false },
      transportLivenessPolicy: {
        responseStartTimeoutMilliseconds: null,
        streamEventIdleTimeoutMilliseconds: null,
      },
    });
    expect(DEFAULT_AGENT_CONFIG.execution).toEqual({
      requestTimeoutMilliseconds: null,
      actorTimeoutMilliseconds: null,
      responseStartTimeoutMilliseconds: null,
      streamEventIdleTimeoutMilliseconds: null,
    });
  });
  it('resolves per-Agent environment bindings only at invocation, not on save', async () => {
    const config = providerConfig('http://127.0.0.1:1/v1');
    if (config.model.kind !== 'provider') throw new Error('Fixture binding');
    const binding = config.model;
    const secured = {
      ...config,
      model: {
        ...binding,
        credential: { reference: 'cloud', environmentVariable: 'MY_API_KEY' },
        config: {
          ...binding.config,
          reference: { ...binding.config.reference, credentialRef: 'cloud' },
        },
      },
    };
    const reads: string[] = [];
    const runtime = createWebModelRuntime(defineAgentWebConfig(secured), {
      readEnvironmentVariable: (name) => {
        reads.push(name);
        return 'private-key';
      },
    });
    expect(reads).toEqual([]);
    expect((await runtime.provider?.checkReadiness())?.status).toBe('ready');
    expect(reads).toEqual(['MY_API_KEY']);
    expect(JSON.stringify(runtime.provider?.inspect())).not.toContain('private-key');
    expect(JSON.stringify(WEB_AGENT_CONFIG_CODEC.encode(secured))).not.toContain('private-key');
  });
  it('rejects raw keys, unknown fields, unsafe URLs, invalid values and missing fields', () => {
    const config = providerConfig('http://localhost:1/v1');
    if (config.model.kind !== 'provider') throw new Error('Fixture binding');
    for (const input of [
      { ...config, apiKey: 'forbidden' },
      { instructions: 'legacy', responseStyle: 'balanced' },
      { ...config, invocation: { ...config.invocation, temperature: 3 } },
      { ...config, execution: { ...config.execution, requestTimeoutMilliseconds: 0 } },
      {
        ...config,
        model: { ...config.model, config: { ...config.model.config, apiKey: 'secret' } },
      },
      {
        ...config,
        model: {
          ...config.model,
          config: {
            ...config.model.config,
            reference: {
              ...config.model.config.reference,
              baseUrl: 'http://user:key@localhost/v1',
            },
          },
        },
      },
    ])
      expect(() => defineAgentWebConfig(input)).toThrow();
    let getterCalled = false;
    expect(() =>
      defineAgentWebConfig({
        ...config,
        get instructions() {
          getterCalled = true;
          return 'unsafe';
        },
      })
    ).toThrow();
    expect(getterCalled).toBe(false);
  });
  it('does not fall back to a host Engine for an unconfigured or mismatched Agent', () => {
    expect(() => createWebModelRuntime(DEFAULT_AGENT_CONFIG, {})).toThrow('Configure a model');
    expect(() =>
      createWebModelRuntime(
        { ...DEFAULT_AGENT_CONFIG, model: { kind: 'engine', engineId: 'missing' } },
        {}
      )
    ).toThrow('not installed');
  });
});
