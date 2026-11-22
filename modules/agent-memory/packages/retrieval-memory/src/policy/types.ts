export interface RetrievalPolicy {
  readonly maxEntryCodepoints: number | null;
  readonly maxChunksPerEntry: number | null;
  readonly maxIdBytes: number | null;
  readonly maxCursorBytes: number | null;
  readonly maxFilterLeaves: number | null;
  readonly maxFilterDepth: number | null;
  readonly maxTopK: number | null;
  readonly embeddingBatchSize: number;
}
