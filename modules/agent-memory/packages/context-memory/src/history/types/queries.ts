import type { MemoryVersionReference } from './reference.js';

export interface ListMemoryVersionsInput {
  readonly memoryId: string;
  readonly limit?: number;
  readonly cursor?: string;
}

export interface MemoryHistoryPage {
  readonly memoryId: string;
  /** A stable upper bound captured by the first page, including across later writes. */
  readonly throughRevision: number;
  readonly versions: readonly MemoryVersionReference[];
  readonly nextCursor?: string;
}
