import type { TokenMeasurement } from '@print-an-agent/model-invocation-core';
import type { SearchResult } from '../../types/search.js';
import type { RetrievalSource } from '../../types/entry.js';

export interface RetrievalCitation {
  readonly number: number;
  readonly entryId: string;
  readonly entryRevision: number;
  readonly chunkId: string;
  readonly representationId: string;
  readonly source: RetrievalSource | null;
}

export interface ReadContextResult extends SearchResult {
  readonly text: string;
  readonly citations: readonly RetrievalCitation[];
  readonly rendererRef: string;
  readonly measurement: TokenMeasurement | null;
  readonly outcome: 'selected' | 'empty' | 'no-chunk-fits';
}
