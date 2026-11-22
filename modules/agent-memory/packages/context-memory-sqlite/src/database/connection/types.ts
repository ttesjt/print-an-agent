import type { DatabaseSync } from 'node:sqlite';

export type SqliteConnectionOptions =
  | { readonly path: string; readonly busyTimeoutMs?: number; readonly database?: never }
  | { readonly database: DatabaseSync; readonly path?: never; readonly busyTimeoutMs?: never };

export interface OpenedMemoryConnection {
  readonly database: DatabaseSync;
  readonly owned: boolean;
}
