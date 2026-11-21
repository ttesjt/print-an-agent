import { expect } from 'vitest';
import { AgentBaseStandaloneError } from '../../src/index.js';
export function standaloneBootstrapConfigInput(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    identity: { id: 'standalone-agent', displayName: 'Standalone Agent' },
    provider: {
      config: {
        kind: 'openai-compatible',
        reference: {
          provider: 'loopback',
          model: 'test-model',
          baseUrl: 'http://127.0.0.1:8080/v1',
          credentialRef: 'credentials/standalone',
        },
        contextWindowTokens: 8_192,
        maxOutputTokens: 1_024,
        supportsReasoning: true,
        compatibility: { supportsDeveloperRole: false },
      },
      transportLivenessPolicy: {
        responseStartTimeoutMilliseconds: 10_000,
        streamEventIdleTimeoutMilliseconds: 20_000,
      },
    },
    credential: {
      reference: 'credentials/standalone',
      environmentVariable: 'TA_AGENT_TEST_API_KEY',
    },
    persistence: { kind: 'memory' },
    mainActor: {
      instructions: 'Answer directly.',
      invocationConfig: { temperature: 0, maxOutputTokens: 256 },
      invocationPolicy: { timeoutMilliseconds: 30_000 },
    },
    request: { timeoutMilliseconds: 40_000 },
    sessionCompaction: { timeoutMilliseconds: 50_000 },
  };
}
export function expectStandaloneConfigInvalid(action: () => unknown): void {
  try {
    action();
    throw new Error('Expected Standalone configuration to fail.');
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(AgentBaseStandaloneError);
    if (!(error instanceof AgentBaseStandaloneError)) return;
    expect(error.code).toBe('STANDALONE_CONFIG_INVALID');
  }
}
