import type { RetrievalSource } from './entry.js';
import type { RetrievalSpace } from './space.js';
import type { RetrievalChunk } from './representation.js';

export interface RetrievalHit extends Omit<RetrievalChunk, 'vector'> {
  readonly source: RetrievalSource | null;
  readonly ranking: {
    readonly metricRef: string;
    readonly value: number;
    readonly order: 'ascending';
    readonly strategyRef: string;
  };
}

export interface SearchResult {
  readonly space: RetrievalSpace;
  readonly hits: readonly RetrievalHit[];
}
