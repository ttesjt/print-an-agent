import { randomUUID } from 'node:crypto';
import type { Mutation, MutationOperation } from '../contracts/inputs.js';
import type { RetrievalBackend, EmbeddingResolver, ChunkerResolver } from '../contracts/ports.js';
import type {
  MutationResult,
  RetrievalPublication,
  RetrievalReceipt,
} from '../contracts/publication.js';
import {
  defineRetrievalPolicy,
  RETRIEVAL_PROTOCOL_POLICY,
  type RetrievalPolicy,
} from '../config.js';
import { assertNotAborted, fail, RetrievalMemoryError } from '../errors.js';
import { entryBody, parseMutation } from '../validation/input.js';
import { equal } from '../validation/json.js';
import { prepareRepresentation, resolveEmbedding } from '../representation/prepare.js';
import { COSINE_METRIC_REF } from '../representation/metric.js';
import { replayRetrieval, requireSpace, requireEntry } from './access.js';
import { persistRetrieval } from './persist.js';
export interface RetrievalResources {
  readonly backend: RetrievalBackend;
  readonly embeddings: EmbeddingResolver;
  readonly chunkers: ChunkerResolver;
}
export type PreparedMutation =
  | { readonly receipt: RetrievalReceipt }
  | { readonly publication: RetrievalPublication };
export interface RetrievalMutationOperations {
  prepare(
    operation: MutationOperation,
    value: unknown,
    signal: AbortSignal
  ): Promise<PreparedMutation>;
  publish(prepared: PreparedMutation, signal: AbortSignal): Promise<MutationResult>;
  run(operation: MutationOperation, input: unknown, signal?: AbortSignal): Promise<MutationResult>;
}
export function createRetrievalMutations(
  resources: RetrievalResources,
  options: Partial<RetrievalPolicy> = {}
): RetrievalMutationOperations {
  const policy = defineRetrievalPolicy(options);
  async function prepare(
    operation: MutationOperation,
    value: unknown,
    signal: AbortSignal
  ): Promise<PreparedMutation> {
    const mutation = parseMutation(operation, value, policy);
    const replay = await replayRetrieval(resources.backend, mutation, signal);
    if (replay !== undefined) return { receipt: replay };
    try {
      return { publication: await candidate(mutation, signal) };
    } catch (cause) {
      // A concurrent identical request may have committed between the initial lookup and authority read.
      if (
        cause instanceof RetrievalMemoryError &&
        ['REVISION_CONFLICT', 'ENTRY_NOT_FOUND', 'MEMORY_ALREADY_EXISTS'].includes(cause.code)
      ) {
        const receipt = await replayRetrieval(resources.backend, mutation, signal);
        if (receipt !== undefined) return { receipt };
      }
      throw cause;
    }
  }
  async function candidate(mutation: Mutation, signal: AbortSignal): Promise<RetrievalPublication> {
    const { input } = mutation;
    assertNotAborted(signal);
    if (mutation.operation === 'create') {
      const { index } = mutation.input;
      if (index.metricRef !== COSINE_METRIC_REF)
        fail('UNSUPPORTED_CAPABILITY', 'Unsupported retrieval metric.');
      const capability = await resolveEmbedding(resources.embeddings, index.embeddingRef, signal);
      const chunker = await resources.chunkers.resolve(index.chunkerRef, signal);
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
        representation: await prepareRepresentation(entry, space, resources, policy, signal),
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
        : await prepareRepresentation(entry, space, resources, policy, signal),
    };
  }
  const publish = (prepared: PreparedMutation, signal: AbortSignal) =>
    persistRetrieval(resources.backend, prepared, signal);
  return {
    prepare,
    publish,
    async run(operation: MutationOperation, input: unknown, signal = new AbortController().signal) {
      try {
        return await publish(await prepare(operation, input, signal), signal);
      } catch (cause) {
        if (cause instanceof RetrievalMemoryError && cause.commit !== undefined) throw cause;
        throw new RetrievalMemoryError(
          cause instanceof RetrievalMemoryError ? cause.code : 'STORAGE_FAILED',
          'Memory mutation did not commit.',
          { cause, commit: { status: 'not-committed' } }
        );
      }
    },
  };
}
