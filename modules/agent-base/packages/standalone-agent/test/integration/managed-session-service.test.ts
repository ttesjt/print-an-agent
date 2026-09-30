import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { parseAgentId } from '@ta-agent/base-identity';
import {
  createSqliteSessionPersistence,
  resolveSqliteRequestJournalTableNames,
  resolveSqliteSessionTableNames,
} from '@ta-agent/base-local-adapters';
import { createRequestFingerprint, parseRequestIdempotencyKey } from '@ta-agent/base-request';
import { parseTurnId } from '@ta-agent/base-session';
import { describe, expect, it } from 'vitest';
import {
  createSharedSqliteStandaloneDefinition,
  createSharedSqliteStandaloneSessionService,
  createStandaloneDirectoryDefinition,
  createStandaloneDirectorySessionService,
  type StandaloneAgentManifestInput,
} from '../../src/index.js';
import { createManagedProfileHarness } from '../support/managed-profile-harness.js';

function manifest(agentId: string): StandaloneAgentManifestInput {
  return {
    schemaVersion: 1,
    identity: { id: agentId, displayName: agentId },
    config: {
      provider: {
        config: {
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
      },
      mainActor: { instructions: 'Answer directly.' },
    },
  };
}

function expectTableMissing(databasePath: string, tableName: string): void {
  const database = new DatabaseSync(databasePath);
  try {
    expect(
      database
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
        .get(tableName)
    ).toBeUndefined();
  } finally {
    database.close();
  }
}

async function withTemporaryDirectory(action: (directory: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'managed-session-service-'));
  try {
    await action(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

describe('managed standalone Session service', () => {
  it('manages a disabled directory Agent, including retired history and restart recovery', async () => {
    await withTemporaryDirectory(async (rootDirectory) => {
      const sqlite = { tablePrefix: 'directory_' };
      const managementProfile = createManagedProfileHarness(
        createStandaloneDirectoryDefinition({
          rootDirectory,
          sqlite,
          readEnvironmentVariable: () => {
            throw new Error('Session management must not load runtime credentials.');
          },
        })
      );
      const created = await managementProfile.create(manifest('directory-owner'));
      await managementProfile.disable({
        agentId: 'directory-owner',
        expectedRevision: created.identity.revision,
      });
      const databasePath = join(rootDirectory, 'directory-owner', 'agent.sqlite');
      const profile = createSqliteSessionPersistence({
        databasePath,
        session: { tablePrefix: sqlite.tablePrefix },
        requestJournal: { tablePrefix: sqlite.tablePrefix },
        clock: () => 100,
      });
      const agentId = parseAgentId('directory-owner');
      const resolved = await profile.session.resolve({ agentId });
      const reference = { agentId, sessionId: resolved.sessionId };
      const mismatched = createStandaloneDirectorySessionService({ rootDirectory });
      await expect(mismatched.list({ agentId })).rejects.toMatchObject({
        code: 'SESSION_SCHEMA_INVALID',
      });
      expectTableMissing(databasePath, resolveSqliteSessionTableNames().schema);
      const execution = await profile.session.acquireSessionExecution(reference);
      const turnId = parseTurnId('interrupted-turn');
      await profile.session.beginTurn({
        ...resolved,
        execution,
        turnId,
        userMessage: { role: 'user', text: 'question', timestamp: 100 },
      });
      const journalReference = {
        ...reference,
        idempotencyKey: parseRequestIdempotencyKey('interrupted-request'),
      };
      await profile.requestJournal.claim({
        ...journalReference,
        execution,
        requestId: 'request',
        fingerprint: createRequestFingerprint({ message: 'question' }),
      });

      const service = createStandaloneDirectorySessionService({
        rootDirectory,
        sqlite,
        clock: () => 100,
      });
      expect((await service.list({ agentId })).records).toHaveLength(1);
      const inspection = await service.inspect(reference);
      if (inspection === undefined) throw new Error('Expected Session inspection.');
      expect((await service.listTurns({ ...reference, limit: 1 }))?.records).toHaveLength(1);
      await expect(service.retire({ ...reference, expectedRevision: 0 })).rejects.toMatchObject({
        code: 'SESSION_BUSY',
      });
      await expect(
        service.recover({ ...reference, expectedExecutionRevision: 0 })
      ).rejects.toMatchObject({
        code: 'SESSION_EXECUTION_CONFLICT',
      });
      await service.recover({
        ...reference,
        expectedExecutionRevision: inspection.execution.revision,
      });
      expect((await service.listTurns(reference))?.records[0]).toMatchObject({ status: 'failed' });
      expect(await profile.requestJournal.inspect(journalReference)).toMatchObject({
        status: 'failed',
      });
      await service.retire({ ...reference, expectedRevision: 0 });

      const reopened = createStandaloneDirectorySessionService({ rootDirectory, sqlite });
      expect((await reopened.list({ agentId })).records).toHaveLength(0);
      expect((await reopened.listRetired({ agentId })).records).toHaveLength(1);
      expect((await reopened.listTurns({ ...reference, limit: 1 }))?.records).toHaveLength(1);
      await reopened.restore({ ...reference, expectedRevision: 1 });
      await reopened.retire({ ...reference, expectedRevision: 2 });
      await expect(
        reopened.purge({
          ...reference,
          expectedRevision: 2,
          confirmation: 'permanently-delete-session',
        })
      ).rejects.toMatchObject({
        code: 'SESSION_METADATA_CONFLICT',
      });
      await reopened.purge({
        ...reference,
        expectedRevision: 3,
        confirmation: 'permanently-delete-session',
      });
      expect(await reopened.inspect(reference)).toBeUndefined();
      expect(await profile.requestJournal.inspect(journalReference)).toBeUndefined();
      await expect(
        reopened.recover({ ...reference, expectedExecutionRevision: inspection.execution.revision })
      ).rejects.toMatchObject({
        code: 'SESSION_NOT_FOUND',
      });
    });
  });

  it('isolates Agents in one SQLite database with custom table names', async () => {
    await withTemporaryDirectory(async (directory) => {
      const databasePath = join(directory, 'shared.sqlite');
      const sqlite = {
        tablePrefix: 'unused_',
        tableNames: {
          managedNamespace: {
            schema: 'product_namespace_schema',
            namespaces: 'product_namespaces',
          },
          session: {
            schema: 'product_session_schema',
            sessions: 'product_sessions',
            turns: 'product_turns',
            branches: 'product_branches',
            compactions: 'product_compactions',
          },
          requestJournal: { schema: 'product_request_schema', entries: 'product_requests' },
        },
      };
      const managementProfile = createManagedProfileHarness(
        createSharedSqliteStandaloneDefinition({
          databasePath,
          sqlite,
          readEnvironmentVariable: () => undefined,
        })
      );
      const first = await managementProfile.create(manifest('first-agent'));
      await managementProfile.create(manifest('second-agent'));
      await managementProfile.disable({
        agentId: 'first-agent',
        expectedRevision: first.identity.revision,
      });
      const profile = createSqliteSessionPersistence({
        databasePath,
        session: {
          tableNames: resolveSqliteSessionTableNames({
            tablePrefix: sqlite.tablePrefix,
            tableNames: sqlite.tableNames.session,
          }),
        },
        requestJournal: {
          tableNames: resolveSqliteRequestJournalTableNames({
            tablePrefix: sqlite.tablePrefix,
            tableNames: sqlite.tableNames.requestJournal,
          }),
        },
      });
      const firstAgentId = parseAgentId('first-agent');
      const secondAgentId = parseAgentId('second-agent');
      const firstSession = await profile.session.resolve({ agentId: firstAgentId });
      const secondSession = await profile.session.resolve({ agentId: secondAgentId });
      const service = createSharedSqliteStandaloneSessionService({ databasePath, sqlite });
      const mismatched = createSharedSqliteStandaloneSessionService({
        databasePath,
        sqlite: { tableNames: { managedNamespace: sqlite.tableNames.managedNamespace } },
      });
      await expect(mismatched.list({ agentId: firstAgentId })).rejects.toMatchObject({
        code: 'SESSION_SCHEMA_INVALID',
      });
      expectTableMissing(databasePath, resolveSqliteSessionTableNames().schema);
      const firstReference = { agentId: firstAgentId, sessionId: firstSession.sessionId };
      const secondReference = { agentId: secondAgentId, sessionId: secondSession.sessionId };

      expect((await service.list({ agentId: firstAgentId })).records).toHaveLength(1);
      expect((await service.list({ agentId: secondAgentId })).records).toHaveLength(1);
      expect(
        await service.inspect({ agentId: firstAgentId, sessionId: secondSession.sessionId })
      ).toBeUndefined();
      await expect(
        service.retire({
          agentId: firstAgentId,
          sessionId: secondSession.sessionId,
          expectedRevision: 0,
        })
      ).rejects.toMatchObject({ code: 'SESSION_NOT_FOUND' });
      await service.retire({ ...firstReference, expectedRevision: 0 });
      await service.purge({
        ...firstReference,
        expectedRevision: 1,
        confirmation: 'permanently-delete-session',
      });
      expect(await service.inspect(firstReference)).toBeUndefined();
      expect(await service.inspect(secondReference)).toMatchObject({ status: 'active' });
      await expect(service.list({ agentId: parseAgentId('missing-agent') })).rejects.toMatchObject({
        code: 'MANAGED_AGENT_NOT_FOUND',
      });
    });
  });
});
