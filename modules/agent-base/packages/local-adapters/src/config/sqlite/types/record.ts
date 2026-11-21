import type { SQLOutputValue } from 'node:sqlite';

export type SqliteRow = Record<string, SQLOutputValue>;
