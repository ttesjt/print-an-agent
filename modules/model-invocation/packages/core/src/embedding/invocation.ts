import {
  MAX_EMBEDDING_TIMEOUT_MILLISECONDS,
  NO_EMBEDDING_TIMEOUT,
  type TextEmbeddingInvocationPolicy,
} from './contracts.js';
import { EmbeddingError } from './errors.js';
import { readEmbeddingRecord, readPositiveInteger } from './validation.js';

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

function throwIfCancelled(signal: AbortSignal, timeoutReason: DOMException | undefined): void {
  if (!signal.aborted) return;
  if (timeoutReason !== undefined && signal.reason === timeoutReason) {
    throw new EmbeddingError('EMBEDDING_INVOCATION_TIMEOUT', 'Embedding invocation timed out.', {
      cause: timeoutReason,
    });
  }
  throw new EmbeddingError(
    'EMBEDDING_INVOCATION_CANCELLED',
    'Embedding invocation was cancelled.',
    {
      cause: signal.reason,
    }
  );
}

export async function runEmbeddingInvocation<T>(
  parentSignal: AbortSignal,
  policy: TextEmbeddingInvocationPolicy,
  operation: (signal: AbortSignal) => Promise<T>
): Promise<T> {
  throwIfCancelled(parentSignal, undefined);
  const timeoutController = new AbortController();
  const timeout = policy.timeoutMilliseconds;
  const deadline = timeout === null ? null : performance.now() + timeout;
  let timeoutReason: DOMException | undefined;
  const expire = (): void => {
    if (parentSignal.aborted || timeoutController.signal.aborted) return;
    timeoutReason = new DOMException('Embedding invocation deadline expired.', 'TimeoutError');
    timeoutController.abort(timeoutReason);
  };
  const handle = timeout === null ? undefined : setTimeout(expire, timeout);
  const signal =
    timeout === null ? parentSignal : AbortSignal.any([parentSignal, timeoutController.signal]);
  const clearTimer = (): void => clearTimeout(handle);
  signal.addEventListener('abort', clearTimer, { once: true });
  const assertActive = (): void => {
    // Do not replace an already observed cancellation with a retroactive local timeout.
    if (!signal.aborted && deadline !== null && performance.now() >= deadline) expire();
    throwIfCancelled(signal, timeoutReason);
  };
  try {
    assertActive();
    const result = await operation(signal);
    // Synchronous backend work and validation can starve the timer until after microtask settlement.
    assertActive();
    return result;
  } catch (cause: unknown) {
    assertActive();
    if (cause instanceof EmbeddingError) throw cause;
    throw new EmbeddingError('EMBEDDING_PROVIDER_FAILED', 'Embedding implementation failed.', {
      cause,
    });
  } finally {
    clearTimer();
    signal.removeEventListener('abort', clearTimer);
  }
}
