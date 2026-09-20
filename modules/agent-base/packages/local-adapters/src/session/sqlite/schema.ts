import type { DatabaseSync, SQLOutputValue } from 'node:sqlite';
import { quoteSqliteIdentifier, sessionActivityIndexName } from './table-names.js';
import { AgentSessionError } from '@ta-agent/base-session';
import { runImmediateTransaction } from './database.js';
import { createSessionStoreMigration } from './migrations/0001_create_session_store.js';
import { addSessionCompactionMigration } from './migrations/0002_add_session_compaction.js';
import { addSessionNavigationMigration } from './migrations/0003_add_session_navigation.js';
import { addSessionMetadataMigration } from './migrations/0004_add_session_metadata.js';
import type { SqliteSessionTableNames } from './table-names.js';

const SESSION_SCHEMA_COMPONENT = 'session';
const CURRENT_SESSION_SCHEMA_VERSION = 4;

const SCHEMA_COLUMNS = Object.freeze(['component', 'version']);
const SESSION_COLUMNS = Object.freeze([
  'agent_id',
  'session_id',
  'next_turn_sequence',
  'created_at',
  'selected_branch_id',
  'navigation_revision',
  'updated_at',
  'title',
  'metadata_revision',
  'metadata_updated_at',
]);
const TURN_COLUMNS = Object.freeze([
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
  'presentation',
  'branch_id',
  'parent_turn_id',
]);
const BRANCH_COLUMNS = Object.freeze([
  'agent_id',
  'session_id',
  'branch_id',
  'parent_branch_id',
  'forked_from_turn_id',
  'head_turn_id',
  'created_at',
]);
const COMPACTION_COLUMNS = Object.freeze([
  'agent_id',
  'session_id',
  'branch_id',
  'revision',
  'through_turn_id',
  'context_message',
  'created_at',
]);

type SqliteRow = Record<string, SQLOutputValue>;

function readSchemaVersion(
  database: DatabaseSync,
  tableNames: SqliteSessionTableNames
): number | undefined {
  let row: SqliteRow | undefined;
  try {
    row = database
      .prepare(
        `SELECT version FROM ${quoteSqliteIdentifier(tableNames.schema)} WHERE component = ?`
      )
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
  if (version !== CURRENT_SESSION_SCHEMA_VERSION) {
    throw new AgentSessionError(
      'SESSION_SCHEMA_UNSUPPORTED',
      `SQLite Session schema version ${version} does not match supported version ${CURRENT_SESSION_SCHEMA_VERSION}.`
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
    throw new AgentSessionError(
      'SESSION_SCHEMA_INVALID',
      `SQLite Session table "${tableName}" does not match the expected schema.`
    );
  }
}

function assertSessionActivityIndex(
  database: DatabaseSync,
  tableNames: SqliteSessionTableNames
): void {
  const indexName = sessionActivityIndexName(tableNames);
  const indexes = database
    .prepare(`PRAGMA index_list(${quoteSqliteIdentifier(tableNames.sessions)})`)
    .all() as SqliteRow[];
  const index = indexes.find((candidate) => candidate.name === indexName);
  if (index === undefined || index.unique !== 0 || index.origin !== 'c' || index.partial !== 0) {
    throw new AgentSessionError(
      'SESSION_SCHEMA_INVALID',
      `SQLite Session activity index "${indexName}" is missing or invalid.`
    );
  }
  const columns = database
    .prepare(`PRAGMA index_xinfo(${quoteSqliteIdentifier(indexName)})`)
    .all() as SqliteRow[];
  const expected = [
    { sequence: 0, name: 'agent_id', descending: 0 },
    { sequence: 1, name: 'updated_at', descending: 1 },
    { sequence: 2, name: 'session_id', descending: 0 },
  ] as const;
  const keyColumns = columns.filter((column) => column.key === 1);
  if (
    keyColumns.length !== expected.length ||
    expected.some(
      ({ sequence, name, descending }) =>
        !keyColumns.some(
          (column) =>
            column.seqno === sequence && column.name === name && column.desc === descending
        )
    )
  ) {
    throw new AgentSessionError(
      'SESSION_SCHEMA_INVALID',
      `SQLite Session activity index "${indexName}" does not match the expected ordering.`
    );
  }
}

export function initializeSessionSchema(
  database: DatabaseSync,
  tableNames: SqliteSessionTableNames
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
      database.exec(createSessionStoreMigration(tableNames));
      database.exec(addSessionCompactionMigration(tableNames));
      database.exec(addSessionNavigationMigration(tableNames));
      database.exec(addSessionMetadataMigration(tableNames));
      database
        .prepare(
          `INSERT INTO ${quoteSqliteIdentifier(tableNames.schema)} (component, version) VALUES (?, ?)`
        )
        .run(SESSION_SCHEMA_COMPONENT, CURRENT_SESSION_SCHEMA_VERSION);
    });
  } else {
    assertKnownSchemaVersion(version);
  }
  assertSessionSchema(database, tableNames);
}

export function assertSessionSchema(
  database: DatabaseSync,
  tableNames: SqliteSessionTableNames
): void {
  const version = readSchemaVersion(database, tableNames);
  assertKnownSchemaVersion(version);
  assertTableColumns(database, tableNames.schema, SCHEMA_COLUMNS);
  assertTableColumns(database, tableNames.sessions, SESSION_COLUMNS);
  assertTableColumns(database, tableNames.turns, TURN_COLUMNS);
  assertTableColumns(database, tableNames.branches, BRANCH_COLUMNS);
  assertTableColumns(database, tableNames.compactions, COMPACTION_COLUMNS);
  assertSessionActivityIndex(database, tableNames);
}

export function configureDefensiveMode(database: DatabaseSync): void {
  database.enableDefensive(true);
}
