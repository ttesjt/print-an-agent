import type { DatabaseSync, SQLOutputValue } from 'node:sqlite';
import { AgentRequestError } from '../../../errors.js';
import { runImmediateTransaction } from './database.js';
import { CREATE_REQUEST_JOURNAL_MIGRATION } from './migrations/0001_create_request_journal.js';

const REQUEST_JOURNAL_SCHEMA_COMPONENT = '@ta-agent/base-request:journal';
const CURRENT_REQUEST_JOURNAL_SCHEMA_VERSION = 1;

const EXPECTED_TABLE_COLUMNS = Object.freeze({
  ta_agent_base_request_journal_schema: Object.freeze(['component', 'version']),
  ta_agent_base_request_journal_entries: Object.freeze([
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
  ]),
});

type SqliteRow = Record<string, SQLOutputValue>;

function readSchemaVersion(database: DatabaseSync): number | undefined {
  let row: SqliteRow | undefined;
  try {
    row = database
      .prepare('SELECT version FROM ta_agent_base_request_journal_schema WHERE component = ?')
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
  tableName: keyof typeof EXPECTED_TABLE_COLUMNS
): void {
  const rows = database.prepare(`PRAGMA table_info(${tableName})`).all() as SqliteRow[];
  const actual = rows.map((row) => row.name);
  const expected = EXPECTED_TABLE_COLUMNS[tableName];
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

export function initializeRequestJournalSchema(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS ta_agent_base_request_journal_schema (
      component TEXT PRIMARY KEY,
      version INTEGER NOT NULL CHECK (version >= 0)
    ) STRICT;
  `);
  const version = readSchemaVersion(database);
  if (version === undefined) {
    runImmediateTransaction(database, () => {
      database.exec(CREATE_REQUEST_JOURNAL_MIGRATION);
      database
        .prepare(
          'INSERT INTO ta_agent_base_request_journal_schema (component, version) VALUES (?, ?)'
        )
        .run(REQUEST_JOURNAL_SCHEMA_COMPONENT, CURRENT_REQUEST_JOURNAL_SCHEMA_VERSION);
    });
  }
  assertRequestJournalSchema(database);
}

export function assertRequestJournalSchema(database: DatabaseSync): void {
  const version = readSchemaVersion(database);
  assertKnownVersion(version);
  assertTableColumns(database, 'ta_agent_base_request_journal_schema');
  assertTableColumns(database, 'ta_agent_base_request_journal_entries');
}

export function configureRequestJournalDefensiveMode(database: DatabaseSync): void {
  database.enableDefensive(true);
}
