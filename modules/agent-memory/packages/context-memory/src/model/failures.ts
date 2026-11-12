import { ActorError } from '@print-an-agent/model-invocation-core';
import { assertMemoryNotAborted, ContextMemoryError } from '../errors.js';

export function isMemoryPlannerTimeout(cause: unknown): cause is ContextMemoryError {
  return (
    cause instanceof ContextMemoryError &&
    cause.code === 'MODEL_INVOCATION_FAILED' &&
    cause.cause instanceof ActorError &&
    cause.cause.code === 'ACTOR_INVOCATION_TIMEOUT'
  );
}
export function throwMemoryPlannerFailure(cause: unknown, signal: AbortSignal): never {
  if (isMemoryPlannerTimeout(cause)) throw cause;
  if (cause instanceof ActorError && cause.code === 'ACTOR_INVOCATION_TIMEOUT')
    throw new ContextMemoryError('MODEL_INVOCATION_FAILED', 'Memory planner Actor timed out.', {
      cause,
      commit: { status: 'not-committed' },
    });
  assertMemoryNotAborted(signal);
  if (cause instanceof ContextMemoryError) throw cause;
  throw new ContextMemoryError('MODEL_INVOCATION_FAILED', 'Memory planner invocation failed.', {
    cause,
  });
}
