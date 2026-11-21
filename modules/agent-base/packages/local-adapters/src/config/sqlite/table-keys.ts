export const SQLITE_AGENT_CONFIG_TABLE_KEYS = ['schema', 'configs'] as const;

export type SqliteAgentConfigTableName = (typeof SQLITE_AGENT_CONFIG_TABLE_KEYS)[number];
