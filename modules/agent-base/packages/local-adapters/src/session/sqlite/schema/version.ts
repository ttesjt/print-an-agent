import { AgentSessionError } from '@print-an-agent/base-session';
import type { DatabaseSync } from 'node:sqlite';
import { quoteSqliteIdentifier } from '../table-names.js';
import type { SqliteRow } from '../types/record.js';
import type { SqliteSessionTableNames } from '../types/table-names.js';

export const SESSION_SCHEMA_COMPONENT = 'session';

export const CURRENT_SESSION_SCHEMA_VERSION = 5;

export function readSchemaVersion(
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

export function assertKnownSchemaVersion(version: number | undefined): asserts version is number {
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
