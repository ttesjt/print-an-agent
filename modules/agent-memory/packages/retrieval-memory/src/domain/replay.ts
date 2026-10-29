import type { Mutation } from '../contracts/inputs.js';
import type { RetrievalBackend } from '../contracts/ports.js';
import type { RetrievalReceipt } from '../contracts/publication.js';
import { defineRetrievalPolicy, type RetrievalPolicy } from '../config.js';
import { parseMutation } from '../validation/input.js';
import { exact, record } from '../validation/json.js';
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
  if (
    operation !== 'create' &&
    operation !== 'ingest' &&
    operation !== 'update' &&
    operation !== 'remove' &&
    operation !== 'reindex'
  )
    fail('INPUT_INVALID', 'Unknown mutation operation.');
  return replayRetrieval(
    backend,
    parseMutation(operation, data.input, defineRetrievalPolicy(options)),
    signal ?? new AbortController().signal
  );
}
