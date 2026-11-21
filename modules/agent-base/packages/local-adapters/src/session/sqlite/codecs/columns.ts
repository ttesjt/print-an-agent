import { AgentSessionError } from '@print-an-agent/base-session';
import type { SqliteRow } from '../types/record.js';

export function requireString(row: SqliteRow, column: string): string {
  const value = row[column];
  if (typeof value !== 'string') {
    throw new AgentSessionError(
      'SESSION_RECORD_INVALID',
      `SQLite Session column "${column}" must be a string.`
    );
  }
  return value;
}

export function optionalString(row: SqliteRow, column: string): string | undefined {
  const value = row[column];
  if (value === null) return undefined;
  return requireString(row, column);
}

export function requireNonNegativeInteger(
  row: SqliteRow,
  column: string,
  label = 'SQLite Session'
): number {
  const value = row[column];
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new AgentSessionError(
      'SESSION_RECORD_INVALID',
      `${label} column "${column}" must be a non-negative safe integer.`
    );
  }
  return value;
}
