import type { AssistantMessage } from '@earendil-works/pi-ai';
import { ModelInvocationError } from '@print-an-agent/model-invocation-core';

export function invocationInterruption(signal: AbortSignal): ModelInvocationError {
  const timedOut = signal.reason instanceof DOMException && signal.reason.name === 'TimeoutError';
  return new ModelInvocationError(
    timedOut ? 'MODEL_INVOCATION_TIMEOUT' : 'MODEL_INVOCATION_CANCELLED',
    timedOut ? 'Model invocation timed out.' : 'Model invocation was cancelled.'
  );
}

export function normalizeProviderFailure(cause: unknown, signal: AbortSignal): Error {
  if (cause instanceof ModelInvocationError) return cause;
  if (signal.aborted) return invocationInterruption(signal);
  return new ModelInvocationError('MODEL_PROVIDER_FAILED', 'Provider invocation failed.', {
    cause,
  });
}
export function throwTerminalFailure(signal: AbortSignal, failure: AssistantMessage): never {
  const cancelled = failure.stopReason === 'aborted' || signal.aborted;
  const timedOut = signal.reason instanceof DOMException && signal.reason.name === 'TimeoutError';
  throw new ModelInvocationError(
    timedOut
      ? 'MODEL_INVOCATION_TIMEOUT'
      : cancelled
        ? 'MODEL_INVOCATION_CANCELLED'
        : 'MODEL_PROVIDER_FAILED',
    failure.errorMessage ??
      (cancelled ? 'Model invocation was cancelled.' : 'Model provider failed.')
  );
}
