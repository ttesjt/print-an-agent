export const SQLITE_SESSION_TABLE_KEYS = [
  'schema',
  'sessions',
  'turns',
  'branches',
  'compactions',
] as const;

export type SqliteSessionTableName = (typeof SQLITE_SESSION_TABLE_KEYS)[number];
