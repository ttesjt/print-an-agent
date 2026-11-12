import type { DatabaseSync } from 'node:sqlite';

import type {
  BaseId,
  ModelBase,
  ModelModification,
  ModelOutput,
  ModelRun,
  ModificationId,
  OutputId,
  ProfileId,
  RunId,
} from '@print-an-agent/workbench-domain';

import {
  PersistenceDataCorruptionError,
  PersistenceProfileScopeError,
  PersistenceRecordConflictError,
  SqlitePersistenceError,
  WorkbenchPersistenceError,
} from '../../errors.js';
import type {
  PersistenceRecordCollection,
  PersistenceRecordStore,
} from '../../record-store/persistence-record-store.js';
import {
  deserializeBase,
  deserializeModification,
  deserializeOutput,
  deserializeRun,
  serializePersistenceRecord,
} from './sqlite-record-codec.js';

interface SqliteCollectionOptions<TIdentity, TRecord extends { readonly profileId: ProfileId }> {
  readonly table: string;
  readonly identityColumn: string;
  readonly recordKind: 'run' | 'base' | 'modification' | 'output';
  readonly profileId: ProfileId;
  readonly database: DatabaseSync;
  readonly parse: (payload: string, identity: string) => TRecord;
  readonly getIdentity: (record: TRecord) => TIdentity;
}

export function createSqlitePersistenceRecordStore(
  database: DatabaseSync,
  profileId: ProfileId
): PersistenceRecordStore {
  return {
    runs: createSqliteCollection<RunId, ModelRun>({
      table: 'workbench_runs',
      identityColumn: 'run_id',
      recordKind: 'run',
      profileId,
      database,
      parse: deserializeRun,
      getIdentity: (run) => run.runId,
    }),
    bases: createSqliteCollection<BaseId, ModelBase>({
      table: 'workbench_bases',
      identityColumn: 'base_id',
      recordKind: 'base',
      profileId,
      database,
      parse: deserializeBase,
      getIdentity: (base) => base.baseId,
    }),
    modifications: createSqliteCollection<ModificationId, ModelModification>({
      table: 'workbench_modifications',
      identityColumn: 'modification_id',
      recordKind: 'modification',
      profileId,
      database,
      parse: deserializeModification,
      getIdentity: (modification) => modification.modificationId,
    }),
    outputs: createSqliteCollection<OutputId, ModelOutput>({
      table: 'workbench_outputs',
      identityColumn: 'output_id',
      recordKind: 'output',
      profileId,
      database,
      parse: deserializeOutput,
      getIdentity: (output) => output.outputId,
    }),
    transaction: <TResult>(operation: () => TResult): TResult =>
      runTransaction(database, operation),
  };
}

function createSqliteCollection<TIdentity, TRecord extends { readonly profileId: ProfileId }>(
  options: SqliteCollectionOptions<TIdentity, TRecord>
): PersistenceRecordCollection<TIdentity, TRecord> {
  const select = options.database.prepare(
    `SELECT payload_json FROM ${options.table} WHERE profile_id = ? AND ${options.identityColumn} = ?`
  );
  const upsert = options.database.prepare(
    `INSERT INTO ${options.table} (profile_id, ${options.identityColumn}, payload_json)
     VALUES (?, ?, ?)
     ON CONFLICT (profile_id, ${options.identityColumn})
     DO UPDATE SET payload_json = excluded.payload_json`
  );
  const list = options.database.prepare(
    `SELECT ${options.identityColumn} AS record_id, payload_json
     FROM ${options.table}
     WHERE profile_id = ? AND ${options.identityColumn} > ?
     ORDER BY ${options.identityColumn} COLLATE BINARY
     LIMIT ?`
  );

  return {
    find: (identity): TRecord | undefined =>
      sqliteOperation(`read ${options.recordKind} record`, () => {
        const identityValue = String(identity);
        const row: unknown = select.get(options.profileId, identityValue);
        if (row === undefined) return undefined;
        const payload = readPayload(row, options.recordKind, identityValue);
        const record = options.parse(payload, identityValue);
        if (
          record.profileId !== options.profileId ||
          String(options.getIdentity(record)) !== identityValue
        ) {
          throw new PersistenceDataCorruptionError(options.recordKind, identityValue);
        }
        return record;
      }),
    list: ({ after, limit }) =>
      sqliteOperation(`list ${options.recordKind} records`, () => {
        const rows: unknown[] = list.all(
          options.profileId,
          after === undefined ? '' : String(after),
          limit + 1
        );
        const records = rows.slice(0, limit).map((row) => {
          const identityValue = readRecordIdentity(row, options.recordKind);
          const payload = readPayload(row, options.recordKind, identityValue);
          const record = options.parse(payload, identityValue);
          if (
            record.profileId !== options.profileId ||
            String(options.getIdentity(record)) !== identityValue
          ) {
            throw new PersistenceDataCorruptionError(options.recordKind, identityValue);
          }
          return record;
        });
        return Object.freeze({
          records: Object.freeze(records),
          hasMore: rows.length > limit,
        });
      }),
    store: (identity, record): void => {
      sqliteOperation(`write ${options.recordKind} record`, () => {
        const identityValue = String(identity);
        if (record.profileId !== options.profileId) {
          throw new PersistenceProfileScopeError(
            options.recordKind,
            identityValue,
            options.profileId,
            record.profileId
          );
        }
        if (String(options.getIdentity(record)) !== identityValue) {
          throw new PersistenceRecordConflictError(options.recordKind, identityValue);
        }
        upsert.run(options.profileId, identityValue, serializePersistenceRecord(record));
      });
    },
  };
}

function readRecordIdentity(row: unknown, recordKind: string): string {
  const identity =
    typeof row === 'object' && row !== null && Object.hasOwn(row, 'record_id')
      ? (row as Readonly<Record<string, unknown>>).record_id
      : undefined;
  if (typeof identity !== 'string') {
    throw new PersistenceDataCorruptionError(recordKind, '<unknown>');
  }
  return identity;
}

function readPayload(row: unknown, recordKind: string, identity: string): string {
  const payload =
    typeof row === 'object' && row !== null && Object.hasOwn(row, 'payload_json')
      ? (row as Readonly<Record<string, unknown>>).payload_json
      : undefined;
  if (typeof payload !== 'string') {
    throw new PersistenceDataCorruptionError(recordKind, identity);
  }
  return payload;
}

function runTransaction<TResult>(database: DatabaseSync, operation: () => TResult): TResult {
  try {
    database.exec('BEGIN IMMEDIATE');
  } catch (cause) {
    throw new SqlitePersistenceError('Could not begin the SQLite transaction.', { cause });
  }
  try {
    const result = operation();
    database.exec('COMMIT');
    return result;
  } catch (cause) {
    rollback(database);
    if (cause instanceof WorkbenchPersistenceError) throw cause;
    throw new SqlitePersistenceError('SQLite transaction failed.', { cause });
  }
}

function sqliteOperation<TResult>(description: string, operation: () => TResult): TResult {
  try {
    return operation();
  } catch (cause) {
    if (cause instanceof WorkbenchPersistenceError) throw cause;
    throw new SqlitePersistenceError(`Failed to ${description}.`, { cause });
  }
}

function rollback(database: DatabaseSync): void {
  try {
    database.exec('ROLLBACK');
  } catch {
    // Preserve the operation failure that triggered rollback.
  }
}
