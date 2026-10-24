import { fail } from './errors.js';
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
export const RETRIEVAL_DEFAULTS = Object.freeze({
  window: 1000,
  overlap: 100,
  topK: 10,
  listLimit: 50,
  contextCandidates: 20,
  contextMaxChunks: 8,
  contextMaxTokens: 4096,
  separator: '\n\n',
});
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
export function defineRetrievalPolicy(options: Partial<RetrievalPolicy> = {}): RetrievalPolicy {
  const policy = { ...DEFAULT_RETRIEVAL_POLICY, ...options };
  for (const [key, value] of Object.entries(policy)) {
    if (
      !(key in DEFAULT_RETRIEVAL_POLICY) ||
      (value === null ? key === 'embeddingBatchSize' : !Number.isSafeInteger(value) || value < 1)
    )
      fail('CONFIG_INVALID', 'Memory policy contains an invalid limit.');
  }
  return Object.freeze(policy);
}
