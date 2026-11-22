import type { RetrievalBackend } from '@print-an-agent/retrieval-memory';
import {
  openSqliteRetrievalBackend,
  type SqliteRetrievalOptions,
  type OwnedRetrievalBackend,
} from '@print-an-agent/retrieval-memory-sqlite';

// Inferred declarations must refer only to public package entries.
export function openBackend(options: SqliteRetrievalOptions) {
  return openSqliteRetrievalBackend(options);
}
export function borrowBackend(owned: OwnedRetrievalBackend): RetrievalBackend {
  return owned;
}
export function configure(options: SqliteRetrievalOptions): void {
  // @ts-expect-error Path has always been readonly.
  options.path = ':memory:';
  // @ts-expect-error The optional timeout has always been readonly.
  options.busyTimeoutMs = 0;
}
export async function release(owned: OwnedRetrievalBackend): Promise<void> {
  await owned.close();
}
export function requireOwnership(borrowed: RetrievalBackend): void {
  // @ts-expect-error A borrowed backend does not acquire ownership through assignment.
  const owned: OwnedRetrievalBackend = borrowed;
  void owned;
}
