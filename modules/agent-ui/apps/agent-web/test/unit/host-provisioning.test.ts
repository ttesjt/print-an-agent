// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadWebProviderRuntime } from '../../src/node/host.js';
import { hostConfig } from '../support/host-config.js';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(cleanup.splice(0).map((close) => close()));
});
const provider = {
  kind: 'openai-compatible',
  reference: { provider: 'local', model: 'fixture', baseUrl: 'http://127.0.0.1:1/v1' },
  contextWindowTokens: 4096,
  maxOutputTokens: 256,
  supportsReasoning: true,
  compatibility: { supportsDeveloperRole: false },
};
async function load(input: unknown) {
  const file = await hostConfig(input);
  cleanup.push(file.close);
  return loadWebProviderRuntime(file.filename);
}
describe('private host provisioning', () => {
  it('uses truthful capability and independent transport policy with no default deadlines', async () => {
    const runtime = await load({ config: provider });
    expect(runtime.inspect()).toMatchObject({
      supportsReasoning: true,
      compatibility: { supportsDeveloperRole: false },
      transportLivenessPolicy: {
        responseStartTimeoutMilliseconds: null,
        streamEventIdleTimeoutMilliseconds: null,
      },
    });
    const limited = await load({
      config: provider,
      transportLivenessPolicy: {
        responseStartTimeoutMilliseconds: 1000,
        streamEventIdleTimeoutMilliseconds: null,
      },
    });
    expect(limited.inspect().transportLivenessPolicy.responseStartTimeoutMilliseconds).toBe(1000);
  });
  it('keeps environment credential values out of config inspection', async () => {
    vi.stubEnv('AGENT_WEB_QUALIFICATION_KEY', 'fixture-only-credential');
    const runtime = await load({
      config: {
        ...provider,
        reference: {
          ...provider.reference,
          credentialRef: 'AGENT_WEB_QUALIFICATION_KEY',
        },
      },
    });
    expect((await runtime.checkReadiness()).status).toBe('ready');
    expect(JSON.stringify(runtime.inspect())).not.toContain('fixture-only-credential');
  });
  it('rejects unknown host fields, raw credentials and malformed liveness policy', async () => {
    for (const input of [
      { config: provider, extra: true },
      { config: { ...provider, apiKey: 'not-allowed' } },
      {
        config: provider,
        transportLivenessPolicy: {
          responseStartTimeoutMilliseconds: 0,
          streamEventIdleTimeoutMilliseconds: null,
        },
      },
      {
        config: provider,
        transportLivenessPolicy: {
          responseStartTimeoutMilliseconds: null,
          streamEventIdleTimeoutMilliseconds: null,
          unknown: true,
        },
      },
    ])
      await expect(load(input)).rejects.toThrow();
  });
});
