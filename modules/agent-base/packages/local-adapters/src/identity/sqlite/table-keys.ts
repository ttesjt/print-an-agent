export const SQLITE_AGENT_IDENTITY_TABLE_KEYS = ['schema', 'identities'] as const;

export type SqliteAgentIdentityTableName = (typeof SQLITE_AGENT_IDENTITY_TABLE_KEYS)[number];
