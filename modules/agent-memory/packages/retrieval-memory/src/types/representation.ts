export interface ChunkContent {
  readonly text: string;
  readonly span: { readonly start: number; readonly end: number } | null;
}

export interface RetrievalChunk extends ChunkContent {
  readonly memoryId: string;
  readonly entryId: string;
  readonly entryRevision: number;
  readonly generationId: string;
  readonly representationId: string;
  readonly chunkId: string;
  readonly ordinal: number;
  readonly vector: readonly number[];
}

export interface EntryRepresentation {
  readonly representationId: string;
  readonly embeddingRef: string;
  readonly chunkerRef: string;
  readonly metricRef: string;
  readonly chunks: readonly RetrievalChunk[];
}
