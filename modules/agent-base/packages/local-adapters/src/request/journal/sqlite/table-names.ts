import { AgentRequestError } from '@print-an-agent/base-request';
import { SQLITE_REQUEST_JOURNAL_TABLE_KEYS } from './table-keys.js';
import type {
  SqliteRequestJournalTableNames,
  SqliteRequestJournalTableNamingInput,
} from './types/table-names.js';

const DEFAULT_TABLE_PREFIX = 'agent_';

const MAX_TABLE_NAME_LENGTH = 128;

const TABLE_NAME_KEYS = new Set<string>(SQLITE_REQUEST_JOURNAL_TABLE_KEYS);

const TABLE_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export const DEFAULT_SQLITE_REQUEST_JOURNAL_TABLE_NAMES: SqliteRequestJournalTableNames =
  Object.freeze({
    schema: 'agent_request_journal_schema',
    entries: 'agent_request_journal_entries',
  });

function namingError(): AgentRequestError {
  return new AgentRequestError(
    'REQUEST_REPLAY_CONFIGURATION_INVALID',
    'SQLite Request Journal table naming is invalid.'
  );
}

function validateIdentifier(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > MAX_TABLE_NAME_LENGTH ||
    !TABLE_NAME_PATTERN.test(value) ||
    value.toLowerCase().startsWith('sqlite_')
  ) {
    throw namingError();
  }
  return value;
}

function resolveOverrides(
  input: SqliteRequestJournalTableNamingInput | undefined
): Map<string, string> {
  const raw: unknown = input?.tableNames;
  if (raw !== undefined && (typeof raw !== 'object' || raw === null || Array.isArray(raw))) {
    throw namingError();
  }
  const overrides = new Map<string, string>();
  for (const key of Object.keys(raw ?? {})) {
    if (!TABLE_NAME_KEYS.has(key)) throw namingError();
    overrides.set(key, validateIdentifier((raw as Readonly<Record<string, unknown>>)[key]));
  }
  return overrides;
}

function resolvePrefix(value: unknown): string {
  if (typeof value !== 'string' || value.length > MAX_TABLE_NAME_LENGTH) throw namingError();
  return value;
}

function assertDistinct(tableNames: SqliteRequestJournalTableNames): void {
  if (tableNames.schema.toLowerCase() === tableNames.entries.toLowerCase()) throw namingError();
}

export function quoteSqliteIdentifier(tableName: string): string {
  return `"${validateIdentifier(tableName)}"`;
}

export function resolveSqliteRequestJournalTableNames(
  input?: SqliteRequestJournalTableNamingInput
): SqliteRequestJournalTableNames {
  const overrides = resolveOverrides(input);
  const prefix = resolvePrefix(input?.tablePrefix ?? DEFAULT_TABLE_PREFIX);
  const tableNames = Object.freeze({
    schema: overrides.get('schema') ?? validateIdentifier(`${prefix}request_journal_schema`),
    entries: overrides.get('entries') ?? validateIdentifier(`${prefix}request_journal_entries`),
  });
  assertDistinct(tableNames);
  return tableNames;
}
