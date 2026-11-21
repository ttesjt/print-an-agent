import { MAX_TIMER_DELAY_MILLISECONDS } from '../timer-limits.js';
import { readEmbeddingRecord, readPositiveInteger } from './validation.js';
import { EmbeddingError } from './errors.js';

export const NO_EMBEDDING_TIMEOUT = null;

export const MAX_EMBEDDING_TIMEOUT_MILLISECONDS = MAX_TIMER_DELAY_MILLISECONDS;

export interface TextEmbeddingInvocationPolicy {
  /** null adds no local deadline; caller cancellation still applies. */
  readonly timeoutMilliseconds: number | null;
}
export function parseEmbeddingInvocationPolicy(input: unknown): TextEmbeddingInvocationPolicy {
  if (input === undefined) return Object.freeze({ timeoutMilliseconds: NO_EMBEDDING_TIMEOUT });
  const code = 'EMBEDDING_BINDING_INVALID';
  const record = readEmbeddingRecord(input, ['timeoutMilliseconds'], code);
  const timeoutMilliseconds =
    record.timeoutMilliseconds === null
      ? null
      : readPositiveInteger(record.timeoutMilliseconds, code);
  if (timeoutMilliseconds !== null && timeoutMilliseconds > MAX_EMBEDDING_TIMEOUT_MILLISECONDS) {
    throw new EmbeddingError(code, 'Embedding timeout exceeds the supported timer range.');
  }
  return Object.freeze({ timeoutMilliseconds });
}
