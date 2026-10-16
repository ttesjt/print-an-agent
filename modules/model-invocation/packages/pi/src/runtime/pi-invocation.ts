import type { ActorInvocationConfig } from '@ta-agent/model-invocation-core';
import { ModelInvocationError } from '@ta-agent/model-invocation-core';
export function toPiInvocationOptions(config: ActorInvocationConfig, apiKey: string | undefined) {
  return {
    ...(config.temperature === undefined ? {} : { temperature: config.temperature }),
    ...(config.maxOutputTokens === undefined ? {} : { maxTokens: config.maxOutputTokens }),
    ...(apiKey === undefined ? {} : { apiKey }),
  };
}

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
