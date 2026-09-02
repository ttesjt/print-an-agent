import type { DatabaseSync, SQLOutputValue } from 'node:sqlite';
import { quoteSqliteIdentifier } from './table-names.js';
import { AgentRequestError } from '@ta-agent/base-request';
import { runImmediateTransaction } from './database.js';
import { createRequestJournalMigration } from './migrations/0001_create_request_journal.js';
import type { SqliteRequestJournalTableNames } from './table-names.js';

const REQUEST_JOURNAL_SCHEMA_COMPONENT = 'request_journal';
const CURRENT_REQUEST_JOURNAL_SCHEMA_VERSION = 1;

const SCHEMA_COLUMNS = Object.freeze(['component', 'version']);
const ENTRY_COLUMNS = Object.freeze([
  'agent_id',
  'session_id',
  'idempotency_key',
  'fingerprint',
  'request_id',
  'status',
  'response_json',
  'failure_code',
  'failure_message',
  'started_at',
  'finished_at',
]);

type SqliteRow = Record<string, SQLOutputValue>;

function readSchemaVersion(
  database: DatabaseSync,
  tableNames: SqliteRequestJournalTableNames
): number | undefined {
  let row: SqliteRow | undefined;
  try {
    row = database
      .prepare(
        `SELECT version FROM ${quoteSqliteIdentifier(tableNames.schema)} WHERE component = ?`
      )
      .get(REQUEST_JOURNAL_SCHEMA_COMPONENT) as SqliteRow | undefined;
  } catch (cause: unknown) {
    throw new AgentRequestError(
      'REQUEST_REPLAY_SCHEMA_INVALID',
      'SQLite Request Journal schema metadata table is invalid.',
      { cause }
    );
  }
  if (row === undefined) return undefined;
  const version = row.version;
  if (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 0) {
    throw new AgentRequestError(
      'REQUEST_REPLAY_SCHEMA_INVALID',
      'SQLite Request Journal schema metadata contains an invalid version.'
    );
  }
  return version;
}

function assertKnownVersion(version: number | undefined): asserts version is number {
  if (version === undefined) {
    throw new AgentRequestError(
      'REQUEST_REPLAY_SCHEMA_INVALID',
      'SQLite Request Journal schema metadata is missing.'
    );
  }
  if (version > CURRENT_REQUEST_JOURNAL_SCHEMA_VERSION) {
    throw new AgentRequestError(
      'REQUEST_REPLAY_SCHEMA_UNSUPPORTED',
      `SQLite Request Journal schema version ${version} is newer than supported version ${CURRENT_REQUEST_JOURNAL_SCHEMA_VERSION}.`
    );
  }
  if (version !== CURRENT_REQUEST_JOURNAL_SCHEMA_VERSION) {
    throw new AgentRequestError(
      'REQUEST_REPLAY_SCHEMA_INVALID',
      `SQLite Request Journal schema version ${version} has no available migration path.`
    );
  }
}

function assertTableColumns(
  database: DatabaseSync,
  tableName: string,
  expected: readonly string[]
): void {
  const rows = database
    .prepare(`PRAGMA table_info(${quoteSqliteIdentifier(tableName)})`)
    .all() as SqliteRow[];
  const actual = rows.map((row) => row.name);
  if (
    actual.length !== expected.length ||
    actual.some((column, index) => column !== expected[index])
  ) {
    throw new AgentRequestError(
      'REQUEST_REPLAY_SCHEMA_INVALID',
      `SQLite Request Journal table "${tableName}" does not match the expected schema.`
    );
  }
}

export function initializeRequestJournalSchema(
  database: DatabaseSync,
  tableNames: SqliteRequestJournalTableNames
): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS ${quoteSqliteIdentifier(tableNames.schema)} (
      component TEXT PRIMARY KEY,
      version INTEGER NOT NULL CHECK (version >= 0)
    ) STRICT;
  `);
  const version = readSchemaVersion(database, tableNames);
  if (version === undefined) {
    runImmediateTransaction(database, () => {
      database.exec(createRequestJournalMigration(tableNames));
      database
        .prepare(
          `INSERT INTO ${quoteSqliteIdentifier(tableNames.schema)} (component, version) VALUES (?, ?)`
        )
        .run(REQUEST_JOURNAL_SCHEMA_COMPONENT, CURRENT_REQUEST_JOURNAL_SCHEMA_VERSION);
    });
  }
  assertRequestJournalSchema(database, tableNames);
}

export function assertRequestJournalSchema(
  database: DatabaseSync,
  tableNames: SqliteRequestJournalTableNames
): void {
  const version = readSchemaVersion(database, tableNames);
  assertKnownVersion(version);
  assertTableColumns(database, tableNames.schema, SCHEMA_COLUMNS);
  assertTableColumns(database, tableNames.entries, ENTRY_COLUMNS);
}

export function configureRequestJournalDefensiveMode(database: DatabaseSync): void {
  database.enableDefensive(true);
}
