import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequestFingerprint, parseRequestIdempotencyKey } from '@ta-agent/base-request';
import { supportsSessionExecution } from '@ta-agent/base-session';
import { describe, expect, it } from 'vitest';
import {
  AgentBaseStandaloneError,
  createSharedSqliteStandaloneAgentRegistry,
  type StandaloneAgentDefinitionInput,
  type StandaloneAgentManifestInput,
} from '../../src/index.js';

const CUSTOM_SQLITE_TABLES = Object.freeze({
  tablePrefix: 'unused_',
  tableNames: Object.freeze({
    identity: Object.freeze({ schema: 'sl_identity_meta', identities: 'sl_identities' }),
    config: Object.freeze({ schema: 'sl_config_meta', configs: 'sl_configs' }),
    session: Object.freeze({
      schema: 'sl_session_meta',
      sessions: 'sl_sessions',
      turns: 'sl_turns',
      branches: 'sl_branches',
      compactions: 'sl_compactions',
    }),
    requestJournal: Object.freeze({ schema: 'sl_request_meta', entries: 'sl_requests' }),
    managedNamespace: Object.freeze({ schema: 'sl_namespace_meta', namespaces: 'sl_namespaces' }),
  }),
});

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

function definition(instructions: string): StandaloneAgentDefinitionInput {
  return {
    provider: {
      kind: 'openai-compatible',
      reference: {
        provider: 'loopback',
        model: 'test-model',
        baseUrl: 'http://127.0.0.1:8080/v1',
      },
      contextWindowTokens: 8_192,
      maxOutputTokens: 1_024,
      supportsReasoning: false,
      compatibility: { supportsDeveloperRole: false },
    },
    mainActor: { instructions },
  };
}

function manifest(
  id: string,
  displayName: string,
  instructions = 'Answer directly.'
): StandaloneAgentManifestInput {
  return {
    schemaVersion: 1,
    identity: { id, displayName },
    config: definition(instructions),
  };
}

async function withSharedDatabase(
  action: (databasePath: string, directory: string) => Promise<void> | void
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'ta-agent-shared-'));
  try {
    await action(join(directory, 'all-agents.sqlite'), directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

describe('shared SQLite managed Agent registry', () => {
  it('rejects cross-domain table collisions before creating the database', async () => {
    await withSharedDatabase(async (databasePath, directory) => {
      expectStandaloneConfigInvalid(() =>
        createSharedSqliteStandaloneAgentRegistry({
          databasePath,
          readEnvironmentVariable: () => undefined,
          sqlite: {
            tableNames: {
              identity: { schema: 'shared_metadata' },
              config: { schema: 'SHARED_METADATA' },
            },
          },
        })
      );
      await expect(readdir(directory)).resolves.toEqual([]);
    });
  });

  it('reopens multiple Agents from one database with isolated resources and no Agent directories', async () => {
    await withSharedDatabase(async (databasePath, directory) => {
      const productDatabase = new DatabaseSync(databasePath);
      productDatabase.exec('CREATE TABLE product_artifacts (artifact_id TEXT PRIMARY KEY) STRICT;');
      productDatabase.prepare('INSERT INTO product_artifacts (artifact_id) VALUES (?)').run('a1');
      productDatabase.close();

      const registry = createSharedSqliteStandaloneAgentRegistry({
        databasePath,
        readEnvironmentVariable: () => undefined,
        sqlite: CUSTOM_SQLITE_TABLES,
      });
      const bro = await registry.create(manifest('bro', 'Bro'));
      await registry.create(manifest('mochi', 'Mochi', 'Be precise.'));
      await registry.updateConfig({
        agentId: 'bro',
        config: definition('Keep it short.'),
        expectedRevision: bro.configRevision,
      });

      const broAgent = await registry.open('bro');
      const mochiAgent = await registry.open('mochi');
      const broSession = await broAgent.agent.resources.session.resolve({
        agentId: broAgent.agent.identity.id,
      });
      const mochiSession = await mochiAgent.agent.resources.session.resolve({
        agentId: mochiAgent.agent.identity.id,
      });
      const journalReference = {
        sessionId: broSession.sessionId,
        idempotencyKey: parseRequestIdempotencyKey('same-request'),
      };
      const broPort = broAgent.agent.resources.session;
      const mochiPort = mochiAgent.agent.resources.session;
      if (!supportsSessionExecution(broPort) || !supportsSessionExecution(mochiPort)) {
        throw new Error('Managed SQLite profile must expose execution fencing.');
      }
      const broExecution = await broPort.acquireSessionExecution({
        agentId: broSession.agentId,
        sessionId: broSession.sessionId,
      });
      const mochiExecution = await mochiPort.acquireSessionExecution({
        agentId: mochiSession.agentId,
        sessionId: mochiSession.sessionId,
      });
      await broAgent.agent.resources.requestJournal.claim({
        execution: broExecution,
        agentId: broAgent.agent.identity.id,
        ...journalReference,
        fingerprint: createRequestFingerprint({ message: 'hello' }),
        requestId: 'request-bro',
      });

      const reopened = createSharedSqliteStandaloneAgentRegistry({
        databasePath,
        readEnvironmentVariable: () => undefined,
        sqlite: CUSTOM_SQLITE_TABLES,
      });
      expect((await reopened.list()).map((entry) => entry.identity.identity.id)).toEqual([
        'bro',
        'mochi',
      ]);
      await expect(reopened.inspect('bro')).resolves.toMatchObject({
        configRevision: 2,
        config: { mainActor: { instructions: 'Keep it short.' } },
        manifestProjection: 'current',
      });
      await expect(reopened.inspect('mochi')).resolves.toMatchObject({
        configRevision: 1,
        config: { mainActor: { instructions: 'Be precise.' } },
      });

      const reopenedBro = await reopened.open('bro');
      const reopenedMochi = await reopened.open('mochi');
      await expect(
        reopenedBro.agent.resources.session.inspect({
          agentId: reopenedBro.agent.identity.id,
          sessionId: broSession.sessionId,
        })
      ).resolves.toMatchObject({ agentId: 'bro', sessionId: broSession.sessionId });
      await expect(
        reopenedMochi.agent.resources.session.inspect({
          agentId: reopenedMochi.agent.identity.id,
          sessionId: mochiSession.sessionId,
        })
      ).resolves.toMatchObject({ agentId: 'mochi', sessionId: mochiSession.sessionId });
      await expect(
        reopenedBro.agent.resources.requestJournal.claim({
          execution: broExecution,
          agentId: reopenedBro.agent.identity.id,
          ...journalReference,
          fingerprint: createRequestFingerprint({ message: 'hello' }),
          requestId: 'request-bro-retry',
        })
      ).resolves.toMatchObject({ status: 'existing' });
      await expect(
        reopenedMochi.agent.resources.requestJournal.claim({
          execution: mochiExecution,
          agentId: reopenedMochi.agent.identity.id,
          ...journalReference,
          sessionId: mochiSession.sessionId,
          fingerprint: createRequestFingerprint({ message: 'hello' }),
          requestId: 'request-mochi',
        })
      ).resolves.toMatchObject({ status: 'claimed' });

      const entries = await readdir(directory, { withFileTypes: true });
      expect(entries.some((entry) => entry.isDirectory())).toBe(false);
      expect(entries.some((entry) => entry.name === 'bro' || entry.name === 'mochi')).toBe(false);

      const inspectedDatabase = new DatabaseSync(databasePath);
      const tables = inspectedDatabase
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
        .all()
        .map((row) => (row as { name: string }).name);
      const productArtifact = inspectedDatabase
        .prepare('SELECT artifact_id FROM product_artifacts')
        .get() as { artifact_id: string };
      inspectedDatabase.close();
      expect(productArtifact.artifact_id).toBe('a1');
      expect(tables).toEqual([
        'product_artifacts',
        'sl_branches',
        'sl_compactions',
        'sl_config_meta',
        'sl_configs',
        'sl_identities',
        'sl_identity_meta',
        'sl_namespace_meta',
        'sl_namespaces',
        'sl_request_meta',
        'sl_requests',
        'sl_session_meta',
        'sl_sessions',
        'sl_turns',
      ]);
    });
  });

  it('keeps interrupted provisioning unpublished and only resumes exact authority', async () => {
    await withSharedDatabase(async (databasePath) => {
      const registry = createSharedSqliteStandaloneAgentRegistry({
        databasePath,
        readEnvironmentVariable: () => undefined,
      });

      const initialize = new DatabaseSync(databasePath);
      initialize.exec(`
        CREATE TABLE IF NOT EXISTS agent_config_schema (
          component TEXT PRIMARY KEY,
          version INTEGER NOT NULL CHECK (version >= 1)
        ) STRICT;
        CREATE TABLE IF NOT EXISTS agent_configs (
          agent_id TEXT PRIMARY KEY,
          schema_version INTEGER NOT NULL CHECK (schema_version >= 1),
          revision INTEGER NOT NULL CHECK (revision >= 1),
          value_json TEXT NOT NULL
        ) STRICT;
        INSERT OR IGNORE INTO agent_config_schema (component, version)
          VALUES ('config', 1);
        CREATE TRIGGER reject_initial_config
        BEFORE INSERT ON agent_configs
        BEGIN
          SELECT RAISE(ABORT, 'injected config failure');
        END;
      `);
      initialize.close();

      await expect(registry.create(manifest('bro', 'Bro'))).rejects.toBeDefined();
      await expect(registry.list()).resolves.toEqual([]);

      const repair = new DatabaseSync(databasePath);
      repair.exec('DROP TRIGGER reject_initial_config;');
      repair.close();

      await expect(registry.create(manifest('bro', 'Different'))).rejects.toMatchObject({
        code: 'STANDALONE_AGENT_STORAGE_INVALID',
      });
      await expect(registry.list()).resolves.toEqual([]);
      await expect(registry.create(manifest('bro', 'Bro'))).resolves.toMatchObject({
        identity: { identity: { id: 'bro', displayName: 'Bro' } },
        configRevision: 1,
      });
    });
  });

  it('rejects a future namespace storage schema', async () => {
    await withSharedDatabase((databasePath) => {
      createSharedSqliteStandaloneAgentRegistry({
        databasePath,
        readEnvironmentVariable: () => undefined,
      });
      const database = new DatabaseSync(databasePath);
      database
        .prepare('UPDATE agent_managed_namespace_schema SET version = ? WHERE component = ?')
        .run(2, 'managed_namespace');
      database.close();

      expect(() =>
        createSharedSqliteStandaloneAgentRegistry({
          databasePath,
          readEnvironmentVariable: () => undefined,
        })
      ).toThrowError(AgentBaseStandaloneError);
      try {
        createSharedSqliteStandaloneAgentRegistry({
          databasePath,
          readEnvironmentVariable: () => undefined,
        });
      } catch (cause: unknown) {
        expect(cause).toMatchObject({ code: 'STANDALONE_AGENT_STORAGE_INVALID' });
      }
    });
  });
});
