import { isMutationOperation } from '../mutation-operations.js';
import type { Mutation } from '../types/mutation.js';
import type { RetrievalBackend } from './types/ports.js';
import type { RetrievalReceipt } from '../types/publication.js';
import { defineRetrievalPolicy } from '../policy/index.js';
import type { RetrievalPolicy } from '../policy/index.js';
import { parseMutation } from './request.js';
import { exact, record } from '../values/index.js';
import { replayRetrieval } from './access.js';
import { fail } from '../errors.js';

/** Full input matching before model acquisition; final publication still arbitrates races. */
export function replayRetrievalMutation(
  backend: RetrievalBackend,
  value: Mutation,
  signal?: AbortSignal,
  options: Partial<RetrievalPolicy> = {}
): Promise<RetrievalReceipt | undefined> {
  const data = record(value);
  exact(data, ['operation', 'input']);
  const operation = data.operation;
  if (!isMutationOperation(operation)) fail('INPUT_INVALID', 'Unknown mutation operation.');
  return replayRetrieval(
    backend,
    parseMutation(operation, data.input, defineRetrievalPolicy(options)),
    signal ?? new AbortController().signal
  );
}
