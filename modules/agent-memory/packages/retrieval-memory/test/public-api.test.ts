import { expect, it } from 'vitest';
import * as memory from '@print-an-agent/retrieval-memory';
it('preserves the deliberate Retrieval Memory runtime API', () => {
  expect(Object.keys(memory).sort()).toEqual([
    'COSINE_METRIC_REF',
    'DEFAULT_RETRIEVAL_EXECUTION_POLICY',
    'DEFAULT_RETRIEVAL_POLICY',
    'DEFAULT_RETRIEVAL_RENDERER',
    'RETRIEVAL_DEFAULTS',
    'RetrievalMemoryError',
    'assertCanonicalVector',
    'assertNotAborted',
    'assertReceiptMatches',
    'canonical',
    'createCodepointChunker',
    'createRetrievalContentBundle',
    'createRetrievalContentQueries',
    'createRetrievalContext',
    'createRetrievalCreateDefinition',
    'createRetrievalGetDefinition',
    'createRetrievalIngestDefinition',
    'createRetrievalInspectDefinition',
    'createRetrievalListDefinition',
    'createRetrievalMemoryBundle',
    'createRetrievalMutations',
    'createRetrievalQueries',
    'createRetrievalReadContextDefinition',
    'createRetrievalReceiptDefinition',
    'createRetrievalReindexDefinition',
    'createRetrievalRemoveDefinition',
    'createRetrievalSearchDefinition',
    'createRetrievalStateMutations',
    'createRetrievalUpdateDefinition',
    'createRetrievalWorkflowResources',
    'decideRetrievalPublication',
    'defineRetrievalExecutionPolicy',
    'defineRetrievalPolicy',
    'findRetrievalCommit',
    'identifier',
    'jsonSnapshot',
    'matchesMetadata',
    'mutationDigest',
    'parseMetadataFilter',
    'parseMutation',
    'parseRetrievalEntry',
    'parseRetrievalReceipt',
    'parseRetrievalSpace',
    'parseStoredEntry',
    'prepareCosineVector',
    'replayRetrievalMutation',
    'validatePublication',
  ]);
});
it('preserves the public retrieval defaults and immutable policy snapshots', () => {
  expect(memory.RETRIEVAL_DEFAULTS).toEqual({
    window: 1000,
    overlap: 100,
    topK: 10,
    listLimit: 50,
    contextCandidates: 20,
    contextMaxChunks: 8,
    contextMaxTokens: 4096,
    separator: '\n\n',
  });
  expect(memory.DEFAULT_RETRIEVAL_POLICY).toEqual({
    maxEntryCodepoints: 100000,
    maxChunksPerEntry: 1000,
    maxIdBytes: 1024,
    maxCursorBytes: 16384,
    maxFilterLeaves: 32,
    maxFilterDepth: 8,
    maxTopK: 1000,
    embeddingBatchSize: 64,
  });
  expect(memory.DEFAULT_RETRIEVAL_EXECUTION_POLICY).toEqual({ timeoutMilliseconds: null });
  expect(Object.isFrozen(memory.RETRIEVAL_DEFAULTS)).toBe(true);
  expect(Object.isFrozen(memory.DEFAULT_RETRIEVAL_POLICY)).toBe(true);
});
