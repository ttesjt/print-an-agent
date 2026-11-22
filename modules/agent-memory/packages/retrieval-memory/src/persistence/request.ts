import { createHash } from 'node:crypto';
import type { Mutation } from '../types/mutation.js';
import type { MutationOperation } from '../mutation-operations.js';
import { DEFAULT_RETRIEVAL_POLICY } from '../policy/index.js';
import type { RetrievalPolicy } from '../policy/index.js';
import { canonical, exact, identifier, integer, record } from '../values/index.js';
import { fail } from '../errors.js';
import { entryBody, indexConfiguration } from '../content/index.js';

export function parseMutation(
  operation: MutationOperation,
  value: unknown,
  policy: RetrievalPolicy = DEFAULT_RETRIEVAL_POLICY
): Mutation {
  const input = record(value);
  const memoryId = identifier(input.memoryId, policy.maxIdBytes);
  const requestId = identifier(input.requestId, policy.maxIdBytes);
  const common = { memoryId, requestId };
  if (operation === 'create') {
    exact(input, ['memoryId', 'requestId', 'index']);
    return { operation, input: { ...common, index: indexConfiguration(input.index) } };
  }
  if (operation === 'ingest') {
    exact(input, ['memoryId', 'requestId', 'content', 'metadata', 'source']);
    return { operation, input: { ...common, ...entryBody(input, policy) } };
  }
  const identity = {
    ...common,
    entryId: identifier(input.entryId, policy.maxIdBytes),
    expectedRevision: integer(input.expectedRevision),
  };
  if (operation === 'update') {
    exact(input, [
      'memoryId',
      'requestId',
      'entryId',
      'expectedRevision',
      'content',
      'metadata',
      'source',
    ]);
    return { operation, input: { ...identity, ...entryBody(input, policy) } };
  }
  if (operation !== 'remove' && operation !== 'reindex')
    fail('INPUT_INVALID', 'Unsupported mutation.');
  exact(input, ['memoryId', 'requestId', 'entryId', 'expectedRevision']);
  return { operation, input: identity };
}

export function mutationDigest(mutation: Mutation): string {
  return createHash('sha256')
    .update('retrieval-memory-request-v1\0')
    .update(
      canonical(
        parseMutation(mutation.operation, mutation.input, {
          ...DEFAULT_RETRIEVAL_POLICY,
          maxIdBytes: null,
          maxEntryCodepoints: null,
        })
      )
    )
    .digest('hex');
}
