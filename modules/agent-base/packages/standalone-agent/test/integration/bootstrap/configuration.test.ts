import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import {
  createSharedSqliteStandaloneDefinition,
  createStandaloneDirectoryDefinition,
  createStandaloneProviderService,
  defineStandaloneAgentBootstrapConfig,
} from '../../../src/index.js';
import {
  expectStandaloneConfigInvalid,
  standaloneBootstrapConfigInput,
} from '../../support/configuration.js';
import { bootstrapTestAgent } from '../../support/owned-setup.js';

describe('Standalone bootstrap configuration authority', () => {
  it('uses authoritative configuration as the only Standalone timeout authority', async () => {
    const config = standaloneBootstrapConfigInput();
    const requestLimits = {
      maxMessageCharacters: 1_000,
      maxInstructionsCharacters: 2_000,
      maxOutputCharacters: 3_000,
      maxReasoningCharacters: 4_000,
      maxModelTurns: 5,
      maxPendingInteractionEvents: 6,
    };
    const agent = await bootstrapTestAgent(config, {
      readEnvironmentVariable: () => undefined,
      requestLimits,
    });

    expect(agent.operations.foreground.config).toMatchObject({
      maxMessageCharacters: 1_000,
      timeoutMilliseconds: 40_000,
    });
    expect(agent.operations.compactSession.config.timeoutMilliseconds).toBe(50_000);
    expect(
      createStandaloneProviderService(defineStandaloneAgentBootstrapConfig(config), {
        readEnvironmentVariable: () => undefined,
      }).inspect().transportLivenessPolicy
    ).toEqual({
      responseStartTimeoutMilliseconds: 10_000,
      streamEventIdleTimeoutMilliseconds: 20_000,
    });

    const legacyOptions = {
      readEnvironmentVariable: () => undefined,
      requestPolicy: { timeoutMilliseconds: 1 },
    };
    const directoryOptions = {
      ...legacyOptions,
      rootDirectory: '/tmp/standalone-timeout-authority',
    };
    const sharedOptions = {
      ...legacyOptions,
      databasePath: '/tmp/standalone-timeout-authority.sqlite',
    };
    await expect(bootstrapTestAgent(config, legacyOptions)).rejects.toMatchObject({
      code: 'STANDALONE_CONFIG_INVALID',
    });
    expectStandaloneConfigInvalid(() => createStandaloneDirectoryDefinition(directoryOptions));
    expectStandaloneConfigInvalid(() => createSharedSqliteStandaloneDefinition(sharedOptions));

    const limitsWithTimeout = { ...requestLimits, timeoutMilliseconds: 1 };
    await expect(
      bootstrapTestAgent(config, {
        readEnvironmentVariable: () => undefined,
        requestLimits: limitsWithTimeout,
      })
    ).rejects.toMatchObject({ code: 'STANDALONE_CONFIG_INVALID' });
  });

  it('constructs memory and explicit SQLite profiles through the same public bootstrap', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'standalone-agent-'));
    const environment = { TA_AGENT_TEST_API_KEY: 'PRIVATE_TEST_KEY' };
    try {
      const memoryAgent = await bootstrapTestAgent(standaloneBootstrapConfigInput(), {
        readEnvironmentVariable: (name) => environment[name as keyof typeof environment],
      });
      const sqliteAgent = await bootstrapTestAgent(
        {
          ...standaloneBootstrapConfigInput(),
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

      await expect(
        createStandaloneProviderService(
          defineStandaloneAgentBootstrapConfig(standaloneBootstrapConfigInput()),
          {
            readEnvironmentVariable: (name) => environment[name as keyof typeof environment],
          }
        ).checkReadiness()
      ).resolves.toMatchObject({
        status: 'ready',
      });
      await expect(
        createStandaloneProviderService(
          defineStandaloneAgentBootstrapConfig(standaloneBootstrapConfigInput()),
          {
            readEnvironmentVariable: () => undefined,
          }
        ).checkReadiness()
      ).resolves.toMatchObject({
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
        'conversations_memory',
        'request_receipts',
        'runtime_config_schema',
        'runtime_configs',
        'runtime_identities',
        'runtime_identity_schema',
        'runtime_managed_namespace_schema',
        'runtime_managed_namespaces',
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

  it('rejects SQLite naming options for Memory persistence and cross-domain collisions', async () => {
    await expect(
      bootstrapTestAgent(standaloneBootstrapConfigInput(), {
        readEnvironmentVariable: () => undefined,
        sqlite: { tablePrefix: 'unused_' },
      })
    ).rejects.toMatchObject({ code: 'STANDALONE_CONFIG_INVALID' });

    await expect(
      bootstrapTestAgent(
        {
          ...standaloneBootstrapConfigInput(),
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
    ).rejects.toMatchObject({ code: 'STANDALONE_CONFIG_INVALID' });
  });
});
