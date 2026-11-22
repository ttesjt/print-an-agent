import { prepareMutationCandidate } from './prepare-candidate.js';
import type { MutationOperation } from '../mutation-operations.js';
import { defineRetrievalPolicy } from '../policy/index.js';
import type { RetrievalPolicy } from '../policy/index.js';
import { RetrievalMemoryError } from '../errors.js';
import { parseMutation, replayRetrieval, persistRetrieval } from '../persistence/index.js';
import type { RetrievalResources } from './types/resources.js';
import type { PreparedMutation } from '../persistence/index.js';
import type { RetrievalMutationOperations } from './types/operations.js';

export function createRetrievalMutations(
  resources: RetrievalResources,
  options: Partial<RetrievalPolicy> = {}
): RetrievalMutationOperations {
  return mutationOperations(resources, options);
}

/** Same CAS/candidate/publication implementation; no embedding/chunker placeholders. */
export function createRetrievalStateMutations(
  resources: Pick<RetrievalResources, 'backend'>,
  options: Partial<RetrievalPolicy> = {}
): RetrievalMutationOperations<'remove'> {
  return mutationOperations(resources, options);
}

function mutationOperations(
  resources: RetrievalResources | Pick<RetrievalResources, 'backend'>,
  options: Partial<RetrievalPolicy>
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
      return { publication: await prepareMutationCandidate(resources, policy, mutation, signal) };
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
