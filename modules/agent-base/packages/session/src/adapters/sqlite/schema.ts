import type { DatabaseSync, SQLOutputValue } from 'node:sqlite';
import { AgentSessionError } from '../../errors.js';
import { runImmediateTransaction } from './database.js';
import { CREATE_SESSION_STORE_MIGRATION } from './migrations/0001_create_session_store.js';
import { ADD_SESSION_COMPACTION_MIGRATION } from './migrations/0002_add_session_compaction.js';

const SESSION_SCHEMA_COMPONENT = '@ta-agent/base-session';
const CURRENT_SESSION_SCHEMA_VERSION = 2;

const EXPECTED_TABLE_COLUMNS = Object.freeze({
  ta_agent_base_session_schema: Object.freeze(['component', 'version']),
  ta_agent_base_sessions: Object.freeze([
    'agent_id',
    'session_id',
    'next_turn_sequence',
    'created_at',
  ]),
  ta_agent_base_session_turns: Object.freeze([
    'agent_id',
    'session_id',
    'turn_id',
    'turn_sequence',
    'status',
    'user_message',
    'assistant_message',
    'failure_code',
    'started_at',
    'finished_at',
  ]),
  ta_agent_base_session_compactions: Object.freeze([
    'agent_id',
    'session_id',
    'revision',
    'through_turn_id',
    'context_message',
    'created_at',
  ]),
});

type SqliteRow = Record<string, SQLOutputValue>;

function readSchemaVersion(database: DatabaseSync): number | undefined {
  let row: SqliteRow | undefined;
  try {
    row = database
      .prepare('SELECT version FROM ta_agent_base_session_schema WHERE component = ?')
      .get(SESSION_SCHEMA_COMPONENT) as SqliteRow | undefined;
  } catch (cause: unknown) {
    throw new AgentSessionError(
      'SESSION_SCHEMA_INVALID',
      'SQLite Session schema metadata table is invalid.',
      { cause }
    );
  }
  if (row === undefined) return undefined;
  const version = row.version;
  if (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 0) {
    throw new AgentSessionError(
      'SESSION_SCHEMA_INVALID',
      'SQLite Session schema metadata contains an invalid version.'
    );
  }
  return version;
}

function assertKnownSchemaVersion(version: number | undefined): asserts version is number {
  if (version === undefined) {
    throw new AgentSessionError(
      'SESSION_SCHEMA_INVALID',
      'SQLite Session schema metadata is missing.'
    );
  }
  if (version > CURRENT_SESSION_SCHEMA_VERSION) {
    throw new AgentSessionError(
      'SESSION_SCHEMA_UNSUPPORTED',
      `SQLite Session schema version ${version} is newer than supported version ${CURRENT_SESSION_SCHEMA_VERSION}.`
    );
  }
  if (version < 1) {
    throw new AgentSessionError(
      'SESSION_SCHEMA_INVALID',
      `SQLite Session schema version ${version} has no available migration path.`
    );
  }
}

function migrateSchema(database: DatabaseSync, version: number): void {
  if (version === 1) {
    runImmediateTransaction(database, () => {
      database.exec(ADD_SESSION_COMPACTION_MIGRATION);
      database
        .prepare('UPDATE ta_agent_base_session_schema SET version = ? WHERE component = ?')
        .run(CURRENT_SESSION_SCHEMA_VERSION, SESSION_SCHEMA_COMPONENT);
    });
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
    throw new AgentSessionError(
      'SESSION_SCHEMA_INVALID',
      `SQLite Session table "${tableName}" does not match the expected schema.`
    );
  }
}

export function initializeSessionSchema(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS ta_agent_base_session_schema (
      component TEXT PRIMARY KEY,
      version INTEGER NOT NULL CHECK (version >= 0)
    ) STRICT;
  `);

  const version = readSchemaVersion(database);
  if (version === undefined) {
    runImmediateTransaction(database, () => {
      database.exec(CREATE_SESSION_STORE_MIGRATION);
      database.exec(ADD_SESSION_COMPACTION_MIGRATION);
      database
        .prepare('INSERT INTO ta_agent_base_session_schema (component, version) VALUES (?, ?)')
        .run(SESSION_SCHEMA_COMPONENT, CURRENT_SESSION_SCHEMA_VERSION);
    });
  } else {
    assertKnownSchemaVersion(version);
    migrateSchema(database, version);
  }
  assertSessionSchema(database);
}

export function assertSessionSchema(database: DatabaseSync): void {
  const version = readSchemaVersion(database);
  assertKnownSchemaVersion(version);
  assertTableColumns(database, 'ta_agent_base_session_schema');
  assertTableColumns(database, 'ta_agent_base_sessions');
  assertTableColumns(database, 'ta_agent_base_session_turns');
  assertTableColumns(database, 'ta_agent_base_session_compactions');
}

export function configureDefensiveMode(database: DatabaseSync): void {
  database.enableDefensive(true);
}
