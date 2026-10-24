import { createHash } from 'node:crypto';
import type { EntryBody, IndexConfiguration } from '../contracts/data.js';
import type { Mutation, MutationOperation } from '../contracts/inputs.js';
import { DEFAULT_RETRIEVAL_POLICY, type RetrievalPolicy } from '../config.js';
import { canonical, exact, identifier, integer, record, text } from './json.js';
import { fail } from '../errors.js';
export function entryBody(
  value: unknown,
  policy: RetrievalPolicy = DEFAULT_RETRIEVAL_POLICY
): Required<EntryBody> {
  const input = record(value);
  const content = text(input.content, true);
  if (policy.maxEntryCodepoints !== null && [...content].length > policy.maxEntryCodepoints)
    fail('INPUT_INVALID', 'Entry exceeds the configured content limit.');
  const metadata = input.metadata === undefined ? {} : record(input.metadata);
  const source =
    input.source === undefined || input.source === null
      ? null
      : (() => {
          const source = record(input.source);
          exact(source, ['ref', 'label']);
          return {
            ref: text(source.ref, true),
            ...(source.label === undefined ? {} : { label: text(source.label) }),
          };
        })();
  return { content, metadata, source };
}
export function indexConfiguration(value: unknown): IndexConfiguration {
  const input = record(value);
  exact(input, ['embeddingRef', 'chunkerRef', 'metricRef']);
  return {
    embeddingRef: identifier(input.embeddingRef),
    chunkerRef: identifier(input.chunkerRef),
    metricRef: identifier(input.metricRef),
  };
}
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
