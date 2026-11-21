import { AgentSessionError } from '@print-an-agent/base-session';
import {
  assertRequestJournalSchema,
  resolveSqliteRequestJournalTableNames,
  SqliteRequestJournalAdapter,
} from '../../request/index.js';
import {
  assertSessionSchema,
  defineSqliteDatabaseConfiguration,
  resolveSqliteSessionTableNames,
  SqliteSessionAdapter,
  useSqliteDatabase,
} from '../../session/index.js';
import type { CoordinatedSessionPersistence } from '../types/ports.js';
import { createSqliteSessionMaintenance } from './maintenance.js';
import type { SqliteSessionPersistenceOptions } from './types.js';

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
    maintenance: createSqliteSessionMaintenance({ use, clock, sessionNames, journalNames }),
  });
}
