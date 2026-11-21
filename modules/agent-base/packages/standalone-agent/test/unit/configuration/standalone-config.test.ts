import { DEFAULT_SESSION_COMPACTION_POLICY } from '@print-an-agent/base-session';
import { describe, expect, it } from 'vitest';
import {
  AgentBaseStandaloneError,
  defineStandaloneAgentBootstrapConfig,
  defineStandaloneAgentConfig,
  defineStandaloneAgentManifest,
  encodeStandaloneAgentManifest,
  STANDALONE_AGENT_CONFIG_CODEC,
} from '../../../src/index.js';
import {
  expectStandaloneConfigInvalid,
  standaloneBootstrapConfigInput,
} from '../../support/configuration.js';

describe('standalone Agent Base configuration', () => {
  it('round-trips the complete token compaction policy without executable tokenizer state', () => {
    const input = standaloneBootstrapConfigInput();
    const policy = {
      timeoutMilliseconds: null,
      maxContextTokens: 2000,
      target: { limitTokens: 2000, ratio: 0.75, reserveTokens: 100 },
      maxGenerationAttempts: 5,
      retrySafetyFactor: 0.7,
      maxGenerationCharacters: 8000,
    };
    input.sessionCompaction = policy;
    const config = defineStandaloneAgentBootstrapConfig(input);
    expect(config.sessionCompaction).toMatchObject(policy);
    const encoded = STANDALONE_AGENT_CONFIG_CODEC.encode({
      provider: config.provider,
      ...(config.credential === undefined ? {} : { credential: config.credential }),
      mainActor: config.mainActor,
      request: config.request,
      sessionCompaction: config.sessionCompaction,
    });
    const decoded = STANDALONE_AGENT_CONFIG_CODEC.decode(encoded);
    expect(decoded.sessionCompaction).toEqual(config.sessionCompaction);
    expect(JSON.stringify(encoded)).not.toContain('counter');
    expect(Object.isFrozen(decoded.sessionCompaction.target)).toBe(true);
  });

  it('rejects getters in non-timeout compaction fields before reading them', () => {
    const input = standaloneBootstrapConfigInput();
    const policy = { timeoutMilliseconds: null };
    let evaluated = false;
    Object.defineProperty(policy, 'maxContextTokens', {
      enumerable: true,
      get() {
        evaluated = true;
        return 20;
      },
    });
    input.sessionCompaction = policy;
    expectStandaloneConfigInvalid(() => defineStandaloneAgentBootstrapConfig(input));
    expect(evaluated).toBe(false);
  });

  it('normalizes and freezes the closed versioned configuration', () => {
    const config = defineStandaloneAgentBootstrapConfig(standaloneBootstrapConfigInput());

    expect(config).toMatchObject({
      schemaVersion: 1,
      identity: { id: 'standalone-agent', displayName: 'Standalone Agent' },
      provider: {
        config: {
          kind: 'openai-compatible',
          reference: { baseUrl: 'http://127.0.0.1:8080/v1' },
          supportsReasoning: true,
          compatibility: { supportsDeveloperRole: false },
        },
        transportLivenessPolicy: {
          responseStartTimeoutMilliseconds: 10_000,
          streamEventIdleTimeoutMilliseconds: 20_000,
        },
      },
      credential: { environmentVariable: 'TA_AGENT_TEST_API_KEY' },
      persistence: { kind: 'memory' },
      mainActor: {
        invocationConfig: { temperature: 0, maxOutputTokens: 256 },
        invocationPolicy: { timeoutMilliseconds: 30_000 },
      },
      request: { timeoutMilliseconds: 40_000 },
      sessionCompaction: { timeoutMilliseconds: 50_000 },
    });
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.identity)).toBe(true);
    expect(Object.isFrozen(config.persistence)).toBe(true);
    expect(Object.isFrozen(config.provider)).toBe(true);
    expect(Object.isFrozen(config.provider.transportLivenessPolicy)).toBe(true);
    expect(Object.isFrozen(config.mainActor)).toBe(true);
    expect(Object.isFrozen(config.mainActor.invocationPolicy)).toBe(true);
    expect(Object.isFrozen(config.request)).toBe(true);
    expect(Object.isFrozen(config.sessionCompaction)).toBe(true);
    expect(config.provider.config.kind).toBe('openai-compatible');
    if (config.provider.config.kind === 'openai-compatible') {
      expect(Object.isFrozen(config.provider.config.compatibility)).toBe(true);
    }
  });

  it('defaults every durable timeout boundary to no automatic timeout and encodes it explicitly', () => {
    const input = standaloneBootstrapConfigInput();
    const provider = input.provider as Record<string, unknown>;
    const mainActor = input.mainActor as Record<string, unknown>;
    delete provider.transportLivenessPolicy;
    delete mainActor.invocationPolicy;
    delete input.request;
    delete input.sessionCompaction;

    const config = defineStandaloneAgentBootstrapConfig(input);
    expect(config.provider.transportLivenessPolicy).toEqual({
      responseStartTimeoutMilliseconds: null,
      streamEventIdleTimeoutMilliseconds: null,
    });
    expect(config.mainActor.invocationPolicy).toEqual({ timeoutMilliseconds: null });
    expect(config.request).toEqual({ timeoutMilliseconds: null });
    expect(config.sessionCompaction).toEqual(DEFAULT_SESSION_COMPACTION_POLICY);

    const encoded = STANDALONE_AGENT_CONFIG_CODEC.encode({
      provider: config.provider,
      ...(config.credential === undefined ? {} : { credential: config.credential }),
      mainActor: config.mainActor,
      request: config.request,
      sessionCompaction: config.sessionCompaction,
    });
    expect(encoded).toMatchObject({
      provider: {
        transportLivenessPolicy: {
          responseStartTimeoutMilliseconds: null,
          streamEventIdleTimeoutMilliseconds: null,
        },
      },
      mainActor: { invocationPolicy: { timeoutMilliseconds: null } },
      request: { timeoutMilliseconds: null },
      sessionCompaction: { timeoutMilliseconds: null },
    });
  });

  it('rejects invalid timeout values at every durable Standalone boundary', () => {
    const invalidValues: readonly unknown[] = [0, -1, 1.5, 2_147_483_648, Infinity, '30000'];
    const applyInvalidValue = [
      (input: Record<string, unknown>, value: unknown) => {
        input.request = { timeoutMilliseconds: value };
      },
      (input: Record<string, unknown>, value: unknown) => {
        input.sessionCompaction = { timeoutMilliseconds: value };
      },
      (input: Record<string, unknown>, value: unknown) => {
        const mainActor = input.mainActor as Record<string, unknown>;
        mainActor.invocationPolicy = { timeoutMilliseconds: value };
      },
      (input: Record<string, unknown>, value: unknown) => {
        const provider = input.provider as Record<string, unknown>;
        provider.transportLivenessPolicy = {
          responseStartTimeoutMilliseconds: value,
          streamEventIdleTimeoutMilliseconds: null,
        };
      },
    ] as const;

    for (const value of invalidValues) {
      for (const apply of applyInvalidValue) {
        const input = standaloneBootstrapConfigInput();
        apply(input, value);
        expectStandaloneConfigInvalid(() => defineStandaloneAgentBootstrapConfig(input));
      }
    }
  });

  it('rejects unknown fields and accessors in durable timeout sections', () => {
    const unknown = standaloneBootstrapConfigInput();
    unknown.request = { timeoutMilliseconds: null, mode: 'soft' };
    expectStandaloneConfigInvalid(() => defineStandaloneAgentBootstrapConfig(unknown));

    const accessor = standaloneBootstrapConfigInput();
    const request = {};
    Object.defineProperty(request, 'timeoutMilliseconds', {
      enumerable: true,
      get: () => null,
    });
    accessor.request = request;
    expectStandaloneConfigInvalid(() => defineStandaloneAgentBootstrapConfig(accessor));
  });

  it('requires explicit OpenAI-compatible instruction-role compatibility', () => {
    const input = standaloneBootstrapConfigInput();
    const provider = (input.provider as Record<string, unknown>).config as Record<string, unknown>;
    delete provider.compatibility;

    expectStandaloneConfigInvalid(() => defineStandaloneAgentBootstrapConfig(input));
  });

  it('requires an explicit OpenAI-compatible reasoning capability declaration', () => {
    const input = standaloneBootstrapConfigInput();
    const provider = (input.provider as Record<string, unknown>).config as Record<string, unknown>;
    delete provider.supportsReasoning;

    expectStandaloneConfigInvalid(() => defineStandaloneAgentBootstrapConfig(input));
  });

  it.each([false, true])(
    'preserves developer-role compatibility through the managed Config codec when set to %s',
    (supportsDeveloperRole) => {
      const input = standaloneBootstrapConfigInput();
      const provider = (input.provider as Record<string, unknown>).config as Record<
        string,
        unknown
      >;
      provider.compatibility = { supportsDeveloperRole };
      const definition = {
        provider: input.provider,
        credential: input.credential,
        mainActor: input.mainActor,
        request: input.request,
        sessionCompaction: input.sessionCompaction,
      };

      const canonical = STANDALONE_AGENT_CONFIG_CODEC.decode(definition);
      const encoded = STANDALONE_AGENT_CONFIG_CODEC.encode(canonical);
      expect(encoded).toMatchObject({
        provider: {
          config: { compatibility: { supportsDeveloperRole } },
          transportLivenessPolicy: {
            responseStartTimeoutMilliseconds: 10_000,
            streamEventIdleTimeoutMilliseconds: 20_000,
          },
        },
        mainActor: { invocationPolicy: { timeoutMilliseconds: 30_000 } },
        request: { timeoutMilliseconds: 40_000 },
        sessionCompaction: { timeoutMilliseconds: 50_000 },
      });
      expect(STANDALONE_AGENT_CONFIG_CODEC.decode(encoded)).toMatchObject({
        provider: {
          config: { compatibility: { supportsDeveloperRole } },
          transportLivenessPolicy: {
            responseStartTimeoutMilliseconds: 10_000,
            streamEventIdleTimeoutMilliseconds: 20_000,
          },
        },
        mainActor: { invocationPolicy: { timeoutMilliseconds: 30_000 } },
        request: { timeoutMilliseconds: 40_000 },
        sessionCompaction: { timeoutMilliseconds: 50_000 },
      });
    }
  );

  it('rejects the obsolete flat Standalone provider shape instead of dual-reading it', () => {
    const input = standaloneBootstrapConfigInput();
    input.provider = (input.provider as Record<string, unknown>).config;

    expectStandaloneConfigInvalid(() => defineStandaloneAgentBootstrapConfig(input));
  });

  it.each([
    [{ ...standaloneBootstrapConfigInput(), unsupported: true }, 'unsupported field'],
    [
      {
        ...standaloneBootstrapConfigInput(),
        provider: {
          config: {
            kind: 'openai-compatible',
            reference: {
              provider: 'loopback',
              model: 'test-model',
              baseUrl: 'http://127.0.0.1:8080/v1',
              unsupported: true,
            },
            contextWindowTokens: 8_192,
            maxOutputTokens: 1_024,
            supportsReasoning: true,
            compatibility: { supportsDeveloperRole: false },
          },
        },
      },
      'invalid',
    ],
    [
      {
        ...standaloneBootstrapConfigInput(),
        credential: {
          reference: 'credentials/wrong',
          environmentVariable: 'TA_AGENT_TEST_API_KEY',
        },
      },
      'match',
    ],
    [
      {
        ...standaloneBootstrapConfigInput(),
        persistence: { kind: 'sqlite', databasePath: 'relative.sqlite' },
      },
      'absolute path',
    ],
    [
      {
        ...standaloneBootstrapConfigInput(),
        persistence: {
          kind: 'sqlite',
          databasePath: '/tmp/agent.sqlite',
          tablePrefix: 'product_',
        },
      },
      'unsupported field',
    ],
  ])('rejects invalid standalone input without widening the schema', (input, message) => {
    try {
      defineStandaloneAgentBootstrapConfig(input);
      throw new Error('Expected standalone configuration validation to fail.');
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(AgentBaseStandaloneError);
      if (!(error instanceof AgentBaseStandaloneError)) return;
      expect(error.code).toBe('STANDALONE_CONFIG_INVALID');
      expect(error.message).toContain(String(message));
    }
  });
});

it.each([
  { request: undefined, sessionCompaction: undefined },
  { request: { timeoutMilliseconds: null }, sessionCompaction: { timeoutMilliseconds: null } },
  {
    request: { timeoutMilliseconds: 1234 },
    sessionCompaction: { timeoutMilliseconds: 5678, maxGenerationAttempts: 4 },
  },
])(
  'keeps managed Config, Bootstrap, Manifest and the canonical codec on one normalization: %j',
  (fields) => {
    const input: Record<string, unknown> = { ...standaloneBootstrapConfigInput(), ...fields };
    const config = {
      provider: input.provider,
      credential: input.credential,
      mainActor: input.mainActor,
      request: input.request,
      sessionCompaction: input.sessionCompaction,
    };
    const canonical = defineStandaloneAgentConfig(config);
    const bootstrap = defineStandaloneAgentBootstrapConfig(input);
    const manifest = defineStandaloneAgentManifest({
      schemaVersion: 1,
      identity: input.identity,
      config,
    });
    for (const value of [bootstrap, manifest.config]) {
      expect(value.provider).toEqual(canonical.provider);
      expect(value.mainActor).toEqual(canonical.mainActor);
      expect(value.request).toEqual(canonical.request);
      expect(value.sessionCompaction).toEqual(canonical.sessionCompaction);
    }
    const encoded = STANDALONE_AGENT_CONFIG_CODEC.encode(canonical);
    expect(STANDALONE_AGENT_CONFIG_CODEC.decode(encoded)).toEqual(canonical);
    expect(encodeStandaloneAgentManifest(manifest)).toEqual({
      schemaVersion: 1,
      identity: manifest.identity,
      config: encoded,
    });
  }
);
