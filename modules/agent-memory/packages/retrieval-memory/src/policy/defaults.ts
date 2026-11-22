import type { RetrievalPolicy } from './types.js';

export const DEFAULT_RETRIEVAL_POLICY: RetrievalPolicy = Object.freeze({
  maxEntryCodepoints: 100000,
  maxChunksPerEntry: 1000,
  maxIdBytes: 1024,
  maxCursorBytes: 16384,
  maxFilterLeaves: 32,
  maxFilterDepth: 8,
  maxTopK: 1000,
  embeddingBatchSize: 64,
});

/** Structural guards never impose an optional caller's business limits a second time. */
export const RETRIEVAL_PROTOCOL_POLICY: RetrievalPolicy = Object.freeze({
  ...DEFAULT_RETRIEVAL_POLICY,
  maxEntryCodepoints: null,
  maxChunksPerEntry: null,
  maxIdBytes: null,
  maxCursorBytes: null,
  maxFilterLeaves: null,
  maxFilterDepth: null,
  maxTopK: null,
});
