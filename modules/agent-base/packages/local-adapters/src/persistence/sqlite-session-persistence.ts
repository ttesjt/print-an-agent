import {
  AgentSessionError,
  assertSessionPurgeAllowed,
  normalizePurgeSessionInput,
  normalizeRecoverSessionExecutionsInput,
} from '@print-an-agent/base-session';
import {
  assertRequestJournalSchema,
  purgeSqliteSessionRequests,
  recoverSqliteSessionRequests,
  resolveSqliteRequestJournalTableNames,
  SqliteRequestJournalAdapter,
  type SqliteRequestJournalTableNamingInput,
} from '../request/index.js';
import {
  assertSessionSchema,
  defineSqliteDatabaseConfiguration,
  purgeSqliteSession,
  readSqliteLifecycle,
  recoverSqliteSession,
  resolveSqliteSessionTableNames,
  runImmediateTransaction,
  SqliteSessionAdapter,
  useSqliteDatabase,
  type SqliteSessionTableNamingInput,
} from '../session/index.js';
import type { CoordinatedSessionPersistence } from './contracts.js';

export interface SqliteSessionPersistenceOptions {
  readonly databasePath: string;
  /** Require the selected Session and Journal schemas to exist without creating them. */
  readonly schemaMode?: 'initialize' | 'existing';
  readonly clock?: () => number;
  readonly busyTimeoutMilliseconds?: number;
  readonly session?: SqliteSessionTableNamingInput;
  readonly requestJournal?: SqliteRequestJournalTableNamingInput;
}

export function createSqliteSessionPersistence(
  options: SqliteSessionPersistenceOptions
): CoordinatedSessionPersistence {
  const sessionNames = resolveSqliteSessionTableNames(options.session);
  const journalNames = resolveSqliteRequestJournalTableNames(options.requestJournal);
  const names = [
    sessionNames.schema,
    sessionNames.sessions,
    sessionNames.turns,
    sessionNames.branches,
    sessionNames.compactions,
    journalNames.schema,
    journalNames.entries,
  ].map((name) => name.toLowerCase());
  if (new Set(names).size !== names.length)
    throw new AgentSessionError(
      'SESSION_CONFIGURATION_INVALID',
      'Persistence table names overlap.'
    );
  const configuration = defineSqliteDatabaseConfiguration(
    options.databasePath,
    options.busyTimeoutMilliseconds
  );
  const clock = options.clock ?? Date.now;
  const common = {
    databasePath: configuration.databasePath,
    clock,
    busyTimeoutMilliseconds: configuration.busyTimeoutMilliseconds,
    ...(options.schemaMode === undefined ? {} : { schemaMode: options.schemaMode }),
  };
  const session = new SqliteSessionAdapter({ ...common, ...options.session });
  const requestJournal = new SqliteRequestJournalAdapter({
    ...common,
    ...options.requestJournal,
    sessionExecution: options.session ?? {},
  });
  const use = <T>(action: Parameters<typeof useSqliteDatabase<T>>[2]): T =>
    useSqliteDatabase(configuration, 'coordinated maintenance', (db) => {
      assertSessionSchema(db, sessionNames);
      assertRequestJournalSchema(db, journalNames);
      return action(db);
    });
  return Object.freeze({
    session,
    requestJournal,
    maintenance: Object.freeze<CoordinatedSessionPersistence['maintenance']>({
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
                throw new AgentSessionError(
                  'SESSION_PURGE_FAILED',
                  'Coordinated deletion failed.',
                  { cause }
                );
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
    }),
  });
}
