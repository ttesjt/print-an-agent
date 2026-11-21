import { AgentSessionError } from '@print-an-agent/base-session';
import type { DatabaseSync } from 'node:sqlite';
import {
  quoteSqliteIdentifier,
  sessionActivityIndexName,
  sessionMemoryTable,
  sessionRetirementIndexName,
} from '../table-names.js';
import type { SqliteRow } from '../types/record.js';
import type { SqliteSessionTableNames } from '../types/table-names.js';
import { assertKnownSchemaVersion, readSchemaVersion } from './version.js';

const SCHEMA_COLUMNS = Object.freeze(['component', 'version']);

const SESSION_COLUMNS = Object.freeze([
  'agent_id',
  'session_id',
  'next_turn_sequence',
  'created_at',
  'lifecycle_status',
  'retired_at',
  'execution_revision',
  'execution_state',
  'execution_leases',
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

function assertSessionListIndex(
  database: DatabaseSync,
  tableNames: SqliteSessionTableNames,
  kind: 'activity' | 'retirement'
): void {
  const indexName =
    kind === 'activity'
      ? sessionActivityIndexName(tableNames)
      : sessionRetirementIndexName(tableNames);
  const indexes = database
    .prepare(`PRAGMA index_list(${quoteSqliteIdentifier(tableNames.sessions)})`)
    .all() as SqliteRow[];
  const index = indexes.find((candidate) => candidate.name === indexName);
  if (index === undefined || index.unique !== 0 || index.origin !== 'c' || index.partial !== 0) {
    throw new AgentSessionError(
      'SESSION_SCHEMA_INVALID',
      `SQLite Session ${kind} index "${indexName}" is missing or invalid.`
    );
  }
  const columns = database
    .prepare(`PRAGMA index_xinfo(${quoteSqliteIdentifier(indexName)})`)
    .all() as SqliteRow[];
  const expected =
    kind === 'activity'
      ? [
          { sequence: 0, name: 'agent_id', descending: 0 },
          { sequence: 1, name: 'updated_at', descending: 1 },
          { sequence: 2, name: 'session_id', descending: 0 },
        ]
      : [
          { sequence: 0, name: 'agent_id', descending: 0 },
          { sequence: 1, name: 'lifecycle_status', descending: 0 },
          { sequence: 2, name: 'retired_at', descending: 1 },
          { sequence: 3, name: 'session_id', descending: 0 },
        ];
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
      `SQLite Session ${kind} index "${indexName}" does not match the expected ordering.`
    );
  }
}

function assertSessionIdentityIndex(
  database: DatabaseSync,
  tableNames: SqliteSessionTableNames
): void {
  const indexes = database
    .prepare(`PRAGMA index_list(${quoteSqliteIdentifier(tableNames.sessions)})`)
    .all();
  const hasUniqueIdentity = indexes.some((index) => {
    if (index.unique !== 1 || index.partial !== 0 || typeof index.name !== 'string') return false;
    const columns = database.prepare('SELECT name FROM pragma_index_info(?)').all(index.name);
    return columns.length === 1 && columns[0]?.name === 'session_id';
  });
  if (!hasUniqueIdentity) {
    throw new AgentSessionError(
      'SESSION_SCHEMA_INVALID',
      'SQLite Session identity must be unique.'
    );
  }
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
  assertTableColumns(database, sessionMemoryTable(tableNames), [
    'agent_id',
    'session_id',
    'kind',
    'id',
    'revision',
    'settled',
    'value',
  ]);
  assertSessionListIndex(database, tableNames, 'activity');
  assertSessionListIndex(database, tableNames, 'retirement');
  assertSessionIdentityIndex(database, tableNames);
}
