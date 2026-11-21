import { AgentSessionError } from '@print-an-agent/base-session';
import { SQLITE_SESSION_TABLE_KEYS } from './table-keys.js';
import type {
  SqliteSessionTableNames,
  SqliteSessionTableNamingInput,
} from './types/table-names.js';

const DEFAULT_TABLE_PREFIX = 'agent_';

const MAX_TABLE_NAME_LENGTH = 128;

const TABLE_NAME_KEYS = new Set<string>(SQLITE_SESSION_TABLE_KEYS);

const TABLE_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export const DEFAULT_SQLITE_SESSION_TABLE_NAMES: SqliteSessionTableNames = Object.freeze({
  schema: 'agent_session_schema',
  sessions: 'agent_sessions',
  turns: 'agent_session_turns',
  branches: 'agent_session_branches',
  compactions: 'agent_session_compactions',
});

function namingError(): AgentSessionError {
  return new AgentSessionError(
    'SESSION_CONFIGURATION_INVALID',
    'SQLite Session table naming is invalid.'
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

function resolveOverrides(input: SqliteSessionTableNamingInput | undefined): Map<string, string> {
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

function assertDistinct(tableNames: readonly string[]): void {
  const normalized = tableNames.map((tableName) => validateIdentifier(tableName).toLowerCase());
  if (new Set(normalized).size !== normalized.length) throw namingError();
}

export function quoteSqliteIdentifier(tableName: string): string {
  return `"${validateIdentifier(tableName)}"`;
}

export function sessionCompactionMigrationTableName(tableNames: SqliteSessionTableNames): string {
  const stagingName = `${tableNames.compactions}_next`;
  assertDistinct([
    tableNames.schema,
    tableNames.sessions,
    tableNames.turns,
    tableNames.branches,
    tableNames.compactions,
    stagingName,
  ]);
  return stagingName;
}

export function sessionActivityIndexName(tableNames: SqliteSessionTableNames): string {
  const indexName = `${tableNames.sessions}_activity_idx`;
  assertDistinct([
    tableNames.schema,
    tableNames.sessions,
    tableNames.turns,
    tableNames.branches,
    tableNames.compactions,
    indexName,
  ]);
  return indexName;
}

export function resolveSqliteSessionTableNames(
  input?: SqliteSessionTableNamingInput
): SqliteSessionTableNames {
  const overrides = resolveOverrides(input);
  const prefix = resolvePrefix(input?.tablePrefix ?? DEFAULT_TABLE_PREFIX);
  const tableNames = Object.freeze({
    schema: overrides.get('schema') ?? validateIdentifier(`${prefix}session_schema`),
    sessions: overrides.get('sessions') ?? validateIdentifier(`${prefix}sessions`),
    turns: overrides.get('turns') ?? validateIdentifier(`${prefix}session_turns`),
    branches: overrides.get('branches') ?? validateIdentifier(`${prefix}session_branches`),
    compactions: overrides.get('compactions') ?? validateIdentifier(`${prefix}session_compactions`),
  });
  const compactionStagingTable = sessionCompactionMigrationTableName(tableNames);
  const activityIndex = sessionActivityIndexName(tableNames);
  const retirementIndex = sessionRetirementIndexName(tableNames);
  assertDistinct([
    tableNames.schema,
    tableNames.sessions,
    tableNames.turns,
    tableNames.branches,
    tableNames.compactions,
    compactionStagingTable,
    activityIndex,
    retirementIndex,
    `${tableNames.sessions}_memory`,
    `${tableNames.sessions}_mem_idx`,
  ]);
  return tableNames;
}

export function sessionRetirementIndexName(tableNames: SqliteSessionTableNames): string {
  return validateIdentifier(`${tableNames.sessions}_retired_idx`);
}

export function sessionMemoryTable(names: SqliteSessionTableNames): string {
  return `${names.sessions}_memory`;
}
