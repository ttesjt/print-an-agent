import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AgentBaseStandaloneError,
  createStandaloneAgent,
  defineStandaloneAgentConfig,
} from '../../src/index.js';

function validConfig(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    identity: { id: 'standalone-agent', displayName: 'Standalone Agent' },
    provider: {
      kind: 'openai-compatible',
      reference: {
        provider: 'loopback',
        model: 'test-model',
        baseUrl: 'http://127.0.0.1:8080/v1',
        credentialRef: 'credentials/standalone',
      },
      contextWindowTokens: 8_192,
      maxOutputTokens: 1_024,
    },
    credential: {
      reference: 'credentials/standalone',
      environmentVariable: 'TA_AGENT_TEST_API_KEY',
    },
    persistence: { kind: 'memory' },
    mainActor: {
      instructions: 'Answer directly.',
      invocationConfig: { temperature: 0, maxOutputTokens: 256 },
    },
  };
}

describe('standalone Agent Base configuration', () => {
  it('normalizes and freezes the closed versioned configuration', () => {
    const config = defineStandaloneAgentConfig(validConfig());

    expect(config).toMatchObject({
      schemaVersion: 1,
      identity: { id: 'standalone-agent', displayName: 'Standalone Agent' },
      provider: {
        kind: 'openai-compatible',
        reference: { baseUrl: 'http://127.0.0.1:8080/v1' },
      },
      credential: { environmentVariable: 'TA_AGENT_TEST_API_KEY' },
      persistence: { kind: 'memory' },
      mainActor: { invocationConfig: { temperature: 0, maxOutputTokens: 256 } },
    });
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.identity)).toBe(true);
    expect(Object.isFrozen(config.persistence)).toBe(true);
  });

  it.each([
    [{ ...validConfig(), unsupported: true }, 'unsupported field'],
    [
      {
        ...validConfig(),
        provider: {
          kind: 'openai-compatible',
          reference: {
            provider: 'loopback',
            model: 'test-model',
            baseUrl: 'http://127.0.0.1:8080/v1',
            unsupported: true,
          },
          contextWindowTokens: 8_192,
          maxOutputTokens: 1_024,
        },
      },
      'invalid',
    ],
    [
      {
        ...validConfig(),
        credential: {
          reference: 'credentials/wrong',
          environmentVariable: 'TA_AGENT_TEST_API_KEY',
        },
      },
      'match',
    ],
    [
      { ...validConfig(), persistence: { kind: 'sqlite', databasePath: 'relative.sqlite' } },
      'absolute path',
    ],
  ])('rejects invalid standalone input without widening the schema', (input, message) => {
    try {
      defineStandaloneAgentConfig(input);
      throw new Error('Expected standalone configuration validation to fail.');
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(AgentBaseStandaloneError);
      if (!(error instanceof AgentBaseStandaloneError)) return;
      expect(error.code).toBe('STANDALONE_CONFIG_INVALID');
      expect(error.message).toContain(String(message));
    }
  });

  it('constructs memory and explicit SQLite profiles through the same public bootstrap', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'standalone-agent-'));
    const environment = { TA_AGENT_TEST_API_KEY: 'PRIVATE_TEST_KEY' };
    try {
      const memoryAgent = createStandaloneAgent(validConfig(), {
        readEnvironmentVariable: (name) => environment[name as keyof typeof environment],
      });
      const sqliteAgent = createStandaloneAgent(
        {
          ...validConfig(),
          persistence: {
            kind: 'sqlite',
            databasePath: join(directory, 'agent.sqlite'),
          },
        },
        { readEnvironmentVariable: () => undefined }
      );

      await expect(memoryAgent.checkProviderReadiness()).resolves.toMatchObject({
        status: 'ready',
      });
      await expect(sqliteAgent.checkProviderReadiness()).resolves.toMatchObject({
        status: 'credential-unavailable',
      });
      expect(memoryAgent.identity.id).toBe('standalone-agent');
      expect(sqliteAgent.identity.id).toBe('standalone-agent');
    } finally {
      await rm(directory, { recursive: true });
    }
  });
});
