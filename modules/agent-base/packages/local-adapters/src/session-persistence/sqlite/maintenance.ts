import {
  AgentSessionError,
  assertSessionPurgeAllowed,
  normalizePurgeSessionInput,
  normalizeRecoverSessionExecutionsInput,
} from '@print-an-agent/base-session';
import type { DatabaseSync } from 'node:sqlite';
import type { SqliteRequestJournalTableNames } from '../../request/index.js';
import { purgeSqliteSessionRequests, recoverSqliteSessionRequests } from '../../request/index.js';
import type { SqliteSessionTableNames } from '../../session/index.js';
import {
  purgeSqliteSession,
  readSqliteLifecycle,
  recoverSqliteSession,
  runImmediateTransaction,
} from '../../session/index.js';
import type {
  CoordinatedSessionMaintenance,
  CoordinatedSessionPersistence,
} from '../types/ports.js';

/** Borrows the Profile's same-database boundary; both domains settle within its transaction. */
export function createSqliteSessionMaintenance(
  input: Readonly<{
    use: <T>(action: (database: DatabaseSync) => T) => T;
    clock: () => number;
    sessionNames: SqliteSessionTableNames;
    journalNames: SqliteRequestJournalTableNames;
  }>
): CoordinatedSessionMaintenance {
  const { use, clock, sessionNames, journalNames } = input;
  return Object.freeze<CoordinatedSessionPersistence['maintenance']>({
    purgeSessionPersistence: (input) =>
      Promise.resolve().then(() => {
        const request = normalizePurgeSessionInput(input);
        use((db) =>
          runImmediateTransaction(db, () => {
            const { snapshot, fence } = readSqliteLifecycle(db, request, sessionNames);
            assertSessionPurgeAllowed(snapshot, request, fence);
            try {
              purgeSqliteSessionRequests(
                db,
                { agentId: request.agentId, sessionId: request.sessionId },
                journalNames
              );
              purgeSqliteSession(db, request, sessionNames);
            } catch (cause: unknown) {
              throw new AgentSessionError('SESSION_PURGE_FAILED', 'Coordinated deletion failed.', {
                cause,
              });
            }
          })
        );
      }),
    recoverSessionPersistence: (input) =>
      Promise.resolve().then(() => {
        const request = normalizeRecoverSessionExecutionsInput(input);
        return use((db) =>
          recoverSqliteSession(db, request, clock, sessionNames, () =>
            recoverSqliteSessionRequests(
              db,
              { agentId: request.agentId, sessionId: request.sessionId },
              clock,
              journalNames
            )
          )
        );
      }),
  });
}
