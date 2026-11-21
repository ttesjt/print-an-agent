import { AgentBaseStandaloneError } from '../../../errors.js';
import type {
  SqliteManagedNamespaceTableNames,
  SqliteManagedNamespaceTableNamingInput,
} from '../types/namespace-tables.js';
import { SQLITE_MANAGED_NAMESPACE_TABLE_KEYS } from './table-keys.js';

const DEFAULT_TABLE_PREFIX = 'agent_';

const MAX_TABLE_NAME_LENGTH = 128;

const TABLE_NAME_KEYS = new Set<string>(SQLITE_MANAGED_NAMESPACE_TABLE_KEYS);

const TABLE_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export const DEFAULT_SQLITE_MANAGED_NAMESPACE_TABLE_NAMES: SqliteManagedNamespaceTableNames =
  Object.freeze({
    schema: 'agent_managed_namespace_schema',
    namespaces: 'agent_managed_namespaces',
  });

function namingError(): AgentBaseStandaloneError {
  return new AgentBaseStandaloneError('Standalone managed namespace table naming is invalid.', {
    code: 'STANDALONE_CONFIG_INVALID',
  });
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
  input: SqliteManagedNamespaceTableNamingInput | undefined
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

function assertDistinct(tableNames: SqliteManagedNamespaceTableNames): void {
  if (tableNames.schema.toLowerCase() === tableNames.namespaces.toLowerCase()) throw namingError();
}

export function quoteSqliteIdentifier(tableName: string): string {
  return `"${validateIdentifier(tableName)}"`;
}

export function resolveSqliteManagedNamespaceTableNames(
  input?: SqliteManagedNamespaceTableNamingInput
): SqliteManagedNamespaceTableNames {
  const overrides = resolveOverrides(input);
  const prefix = resolvePrefix(input?.tablePrefix ?? DEFAULT_TABLE_PREFIX);
  const tableNames = Object.freeze({
    schema: overrides.get('schema') ?? validateIdentifier(`${prefix}managed_namespace_schema`),
    namespaces: overrides.get('namespaces') ?? validateIdentifier(`${prefix}managed_namespaces`),
  });
  assertDistinct(tableNames);
  return tableNames;
}
