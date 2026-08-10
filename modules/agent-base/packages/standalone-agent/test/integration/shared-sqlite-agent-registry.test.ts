import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequestFingerprint, parseRequestIdempotencyKey } from '@ta-agent/base-request';
import { describe, expect, it } from 'vitest';
import {
  AgentBaseStandaloneError,
  createSharedSqliteStandaloneAgentRegistry,
  type StandaloneAgentDefinitionInput,
  type StandaloneAgentManifestInput,
} from '../../src/index.js';

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
  it('reopens multiple Agents from one database with isolated resources and no Agent directories', async () => {
    await withSharedDatabase(async (databasePath, directory) => {
      const registry = createSharedSqliteStandaloneAgentRegistry({
        databasePath,
        readEnvironmentVariable: () => undefined,
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
        requestedSessionId: 'same-session',
      });
      const mochiSession = await mochiAgent.agent.resources.session.resolve({
        agentId: mochiAgent.agent.identity.id,
        requestedSessionId: 'same-session',
      });
      const journalReference = {
        sessionId: broSession.sessionId,
        idempotencyKey: parseRequestIdempotencyKey('same-request'),
      };
      await broAgent.agent.resources.requestJournal.claim({
        agentId: broAgent.agent.identity.id,
        ...journalReference,
        fingerprint: createRequestFingerprint({ message: 'hello' }),
        requestId: 'request-bro',
      });

      const reopened = createSharedSqliteStandaloneAgentRegistry({
        databasePath,
        readEnvironmentVariable: () => undefined,
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
      ).resolves.toMatchObject({ agentId: 'bro', sessionId: 'same-session' });
      await expect(
        reopenedMochi.agent.resources.session.inspect({
          agentId: reopenedMochi.agent.identity.id,
          sessionId: mochiSession.sessionId,
        })
      ).resolves.toMatchObject({ agentId: 'mochi', sessionId: 'same-session' });
      await expect(
        reopenedBro.agent.resources.requestJournal.claim({
          agentId: reopenedBro.agent.identity.id,
          ...journalReference,
          fingerprint: createRequestFingerprint({ message: 'hello' }),
          requestId: 'request-bro-retry',
        })
      ).resolves.toMatchObject({ status: 'existing' });
      await expect(
        reopenedMochi.agent.resources.requestJournal.claim({
          agentId: reopenedMochi.agent.identity.id,
          ...journalReference,
          fingerprint: createRequestFingerprint({ message: 'hello' }),
          requestId: 'request-mochi',
        })
      ).resolves.toMatchObject({ status: 'claimed' });

      const entries = await readdir(directory, { withFileTypes: true });
      expect(entries.some((entry) => entry.isDirectory())).toBe(false);
      expect(entries.some((entry) => entry.name === 'bro' || entry.name === 'mochi')).toBe(false);
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
        CREATE TABLE IF NOT EXISTS ta_agent_base_config_schema (
          component TEXT PRIMARY KEY,
          version INTEGER NOT NULL CHECK (version >= 1)
        ) STRICT;
        CREATE TABLE IF NOT EXISTS ta_agent_base_configs (
          agent_id TEXT PRIMARY KEY,
          schema_version INTEGER NOT NULL CHECK (schema_version >= 1),
          revision INTEGER NOT NULL CHECK (revision >= 1),
          value_json TEXT NOT NULL
        ) STRICT;
        INSERT OR IGNORE INTO ta_agent_base_config_schema (component, version)
          VALUES ('@ta-agent/base-config', 1);
        CREATE TRIGGER reject_initial_config
        BEFORE INSERT ON ta_agent_base_configs
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
        .prepare(
          'UPDATE ta_agent_base_managed_namespace_schema SET version = ? WHERE component = ?'
        )
        .run(2, '@ta-agent/base-standalone-agent:managed-namespace');
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
