import type { TextEmbeddingInvocationPolicy } from './invocation-policy.js';
import { EmbeddingError } from './errors.js';

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
