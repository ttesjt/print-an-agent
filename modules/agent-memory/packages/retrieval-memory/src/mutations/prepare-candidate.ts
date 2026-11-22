import { randomUUID } from 'node:crypto';
import type { Mutation } from '../types/mutation.js';
import type { RetrievalPublication } from '../types/publication.js';
import { RETRIEVAL_PROTOCOL_POLICY } from '../policy/index.js';
import type { RetrievalPolicy } from '../policy/index.js';
import { assertNotAborted, fail } from '../errors.js';
import { entryBody } from '../content/index.js';
import { requireSpace, requireEntry } from '../persistence/index.js';
import { equal } from '../values/index.js';
import { prepareRepresentation, resolveEmbedding } from '../representation/index.js';
import { COSINE_METRIC_REF } from '../representation/metric.js';
import type { RetrievalResources } from './types/resources.js';

export async function prepareMutationCandidate(
  resources: RetrievalResources | Pick<RetrievalResources, 'backend'>,
  policy: RetrievalPolicy,
  mutation: Mutation,
  signal: AbortSignal
): Promise<RetrievalPublication> {
  function models(): RetrievalResources {
    if (!('embeddings' in resources) || !('chunkers' in resources))
      fail('UNSUPPORTED_CAPABILITY', 'This mutation requires representation capabilities.');
    return resources;
  }
  const { input } = mutation;
  assertNotAborted(signal);
  if (mutation.operation === 'create') {
    const { index } = mutation.input;
    if (index.metricRef !== COSINE_METRIC_REF)
      fail('UNSUPPORTED_CAPABILITY', 'Unsupported retrieval metric.');
    const model = models();
    const capability = await resolveEmbedding(model.embeddings, index.embeddingRef, signal);
    const chunker = await model.chunkers.resolve(index.chunkerRef, signal);
    assertNotAborted(signal);
    if (chunker.ref !== index.chunkerRef)
      fail('REPRESENTATION_INVALID', 'Chunker identity mismatch.');
    return {
      mutation,
      space: {
        memoryId: input.memoryId,
        revision: 1,
        sequence: 0,
        index: {
          ...index,
          dimensions: capability.descriptor.representation.dimensions,
          generationId: randomUUID(),
        },
      },
      expected: null,
      entry: null,
      representation: null,
    };
  }
  const space = await requireSpace(resources.backend, input.memoryId, signal);
  if (mutation.operation === 'ingest') {
    const entry = {
      memoryId: input.memoryId,
      entryId: randomUUID(),
      revision: 1,
      ...entryBody(mutation.input, policy),
    };
    return {
      mutation,
      space,
      expected: null,
      entry,
      representation: await prepareRepresentation(entry, space, models(), policy, signal),
    };
  }
  const previous = await requireEntry(resources.backend, space, mutation.input.entryId, signal);
  if (previous.entry.revision !== mutation.input.expectedRevision)
    fail('REVISION_CONFLICT', 'Entry revision changed.');
  const expected = {
    revision: previous.entry.revision,
    representationId: previous.representation.representationId,
  };
  if (mutation.operation === 'remove')
    return { mutation, space, expected, entry: null, representation: null };
  const body =
    mutation.operation === 'update'
      ? entryBody(mutation.input, policy)
      : entryBody(previous.entry, RETRIEVAL_PROTOCOL_POLICY);
  const unchanged =
    mutation.operation === 'update' &&
    equal(body, entryBody(previous.entry, RETRIEVAL_PROTOCOL_POLICY));
  const entry = {
    ...previous.entry,
    ...body,
    revision: previous.entry.revision + (mutation.operation === 'update' && !unchanged ? 1 : 0),
  };
  return {
    mutation,
    space,
    expected,
    entry,
    representation: unchanged
      ? previous.representation
      : await prepareRepresentation(entry, space, models(), policy, signal),
  };
}
