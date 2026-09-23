import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import {
  AgentBaseStandaloneError,
  createStandaloneAgent,
  defineStandaloneAgentConfig,
  STANDALONE_AGENT_DEFINITION_CODEC,
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
      supportsReasoning: true,
      compatibility: { supportsDeveloperRole: false },
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

function expectStandaloneConfigInvalid(action: () => unknown): void {
  try {
    action();
    throw new Error('Expected Standalone SQLite configuration to fail.');
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(AgentBaseStandaloneError);
    if (!(error instanceof AgentBaseStandaloneError)) return;
    expect(error.code).toBe('STANDALONE_CONFIG_INVALID');
  }
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
        supportsReasoning: true,
        compatibility: { supportsDeveloperRole: false },
      },
      credential: { environmentVariable: 'TA_AGENT_TEST_API_KEY' },
      persistence: { kind: 'memory' },
      mainActor: { invocationConfig: { temperature: 0, maxOutputTokens: 256 } },
    });
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.identity)).toBe(true);
    expect(Object.isFrozen(config.persistence)).toBe(true);
    expect(config.provider.kind).toBe('openai-compatible');
    if (config.provider.kind === 'openai-compatible') {
      expect(Object.isFrozen(config.provider.compatibility)).toBe(true);
    }
  });

  it('requires explicit OpenAI-compatible instruction-role compatibility', () => {
    const input = validConfig();
    const provider = input.provider as Record<string, unknown>;
    delete provider.compatibility;

    expectStandaloneConfigInvalid(() => defineStandaloneAgentConfig(input));
  });

  it('requires an explicit OpenAI-compatible reasoning capability declaration', () => {
    const input = validConfig();
    const provider = input.provider as Record<string, unknown>;
    delete provider.supportsReasoning;

    expectStandaloneConfigInvalid(() => defineStandaloneAgentConfig(input));
  });

  it.each([false, true])(
    'preserves developer-role compatibility through the managed Config codec when set to %s',
    (supportsDeveloperRole) => {
      const input = validConfig();
      const provider = input.provider as Record<string, unknown>;
      provider.compatibility = { supportsDeveloperRole };
      const definition = {
        provider: input.provider,
        credential: input.credential,
        mainActor: input.mainActor,
      };

      const canonical = STANDALONE_AGENT_DEFINITION_CODEC.decode(definition);
      const encoded = STANDALONE_AGENT_DEFINITION_CODEC.encode(canonical);
      expect(encoded).toMatchObject({
        provider: { compatibility: { supportsDeveloperRole } },
      });
      expect(STANDALONE_AGENT_DEFINITION_CODEC.decode(encoded)).toMatchObject({
        provider: { compatibility: { supportsDeveloperRole } },
      });
    }
  );

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
          supportsReasoning: true,
          compatibility: { supportsDeveloperRole: false },
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
    [
      {
        ...validConfig(),
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
        {
          readEnvironmentVariable: () => undefined,
          sqlite: {
            tablePrefix: 'runtime_',
            tableNames: {
              session: { sessions: 'conversations' },
              requestJournal: { entries: 'request_receipts' },
            },
          },
        }
      );

      await expect(memoryAgent.checkProviderReadiness()).resolves.toMatchObject({
        status: 'ready',
      });
      await expect(sqliteAgent.checkProviderReadiness()).resolves.toMatchObject({
        status: 'credential-unavailable',
      });
      expect(memoryAgent.identity.id).toBe('standalone-agent');
      expect(sqliteAgent.identity.id).toBe('standalone-agent');

      const database = new DatabaseSync(join(directory, 'agent.sqlite'));
      const tables = database
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
        .all()
        .map((row) => (row as { name: string }).name);
      database.close();
      expect(tables).toEqual([
        'conversations',
        'request_receipts',
        'runtime_request_journal_schema',
        'runtime_session_branches',
        'runtime_session_compactions',
        'runtime_session_schema',
        'runtime_session_turns',
      ]);
    } finally {
      await rm(directory, { recursive: true });
    }
  });

  it('rejects SQLite naming options for Memory persistence and cross-domain collisions', () => {
    expectStandaloneConfigInvalid(() =>
      createStandaloneAgent(validConfig(), {
        readEnvironmentVariable: () => undefined,
        sqlite: { tablePrefix: 'unused_' },
      })
    );

    expectStandaloneConfigInvalid(() =>
      createStandaloneAgent(
        {
          ...validConfig(),
          persistence: { kind: 'sqlite', databasePath: '/tmp/collision-agent.sqlite' },
        },
        {
          readEnvironmentVariable: () => undefined,
          sqlite: {
            tableNames: {
              session: { sessions: 'shared_records' },
              requestJournal: { entries: 'SHARED_RECORDS' },
            },
          },
        }
      )
    );
  });
});
