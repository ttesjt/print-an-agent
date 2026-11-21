export const SQLITE_REQUEST_JOURNAL_TABLE_KEYS = ['schema', 'entries'] as const;

export type SqliteRequestJournalTableName = (typeof SQLITE_REQUEST_JOURNAL_TABLE_KEYS)[number];
