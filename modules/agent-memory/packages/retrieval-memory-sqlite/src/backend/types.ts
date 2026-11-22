import type { RetrievalBackend } from '@print-an-agent/retrieval-memory';

export interface SqliteRetrievalOptions {
  readonly path: string;
  readonly busyTimeoutMs?: number;
}
export interface OwnedRetrievalBackend extends RetrievalBackend {
  close(): Promise<void>;
}
