import { AgentConfigError } from '@print-an-agent/base-identity-config/config';

export type SqliteAgentConfigTableName = 'schema' | 'configs';

export type SqliteAgentConfigTableNamesInput = Readonly<
  Partial<Record<SqliteAgentConfigTableName, string>>
>;

export interface SqliteAgentConfigTableNamingInput {
  readonly tablePrefix?: string;
  readonly tableNames?: SqliteAgentConfigTableNamesInput;
}

export interface SqliteAgentConfigTableNames {
  readonly schema: string;
  readonly configs: string;
}

const DEFAULT_TABLE_PREFIX = 'agent_';
const MAX_TABLE_NAME_LENGTH = 128;
const TABLE_NAME_KEYS = new Set<string>(['schema', 'configs']);
const TABLE_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export const DEFAULT_SQLITE_AGENT_CONFIG_TABLE_NAMES: SqliteAgentConfigTableNames = Object.freeze({
  schema: 'agent_config_schema',
  configs: 'agent_configs',
});

function namingError(): AgentConfigError {
  return new AgentConfigError(
    'CONFIG_CONFIGURATION_INVALID',
    'SQLite Config table naming is invalid.'
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
  input: SqliteAgentConfigTableNamingInput | undefined
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

function assertDistinct(tableNames: SqliteAgentConfigTableNames): void {
  if (tableNames.schema.toLowerCase() === tableNames.configs.toLowerCase()) throw namingError();
}

export function quoteSqliteIdentifier(tableName: string): string {
  return `"${validateIdentifier(tableName)}"`;
}

export function resolveSqliteAgentConfigTableNames(
  input?: SqliteAgentConfigTableNamingInput
): SqliteAgentConfigTableNames {
  const overrides = resolveOverrides(input);
  const prefix = resolvePrefix(input?.tablePrefix ?? DEFAULT_TABLE_PREFIX);
  const tableNames = Object.freeze({
    schema: overrides.get('schema') ?? validateIdentifier(`${prefix}config_schema`),
    configs: overrides.get('configs') ?? validateIdentifier(`${prefix}configs`),
  });
  assertDistinct(tableNames);
  return tableNames;
}
