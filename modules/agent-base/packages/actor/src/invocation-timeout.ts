import { AgentActorError } from './errors.js';
import type { ActorInvocationPolicy } from './invocation-policy.js';

interface RunActorInvocationOptions {
  readonly actorId: string;
  readonly invocationKind: 'complete' | 'interact';
  readonly parentSignal: AbortSignal;
  readonly policy: ActorInvocationPolicy;
}

export async function runActorInvocation<T>(
  options: RunActorInvocationOptions,
  operation: (signal: AbortSignal, assertWithinDeadline: () => void) => Promise<T>
): Promise<T> {
  const timeoutMilliseconds = options.policy.timeoutMilliseconds;
  if (timeoutMilliseconds === null) {
    return operation(options.parentSignal, () => undefined);
  }
  if (options.parentSignal.aborted) {
    return operation(options.parentSignal, () => undefined);
  }

  const timeoutController = new AbortController();
  let ownedTimeoutReason: DOMException | undefined;
  const timeoutHandle = setTimeout(() => {
    ownedTimeoutReason = new DOMException(
      `Actor ${options.actorId} ${options.invocationKind} invocation exceeded ${timeoutMilliseconds} milliseconds`,
      'TimeoutError'
    );
    timeoutController.abort(ownedTimeoutReason);
  }, timeoutMilliseconds);

  const effectiveSignal = AbortSignal.any([options.parentSignal, timeoutController.signal]);
  const clearTimer = (): void => {
    clearTimeout(timeoutHandle);
  };
  effectiveSignal.addEventListener('abort', clearTimer, { once: true });
  if (effectiveSignal.aborted) {
    clearTimer();
  }

  let result: T;
  try {
    result = await operation(effectiveSignal, () => {
      if (ownedTimeoutReason !== undefined) throw ownedTimeoutReason;
    });
  } catch (cause) {
    if (isAuthoritativeProtocolFailure(cause) || ownedTimeoutReason === undefined) {
      throw cause;
    }

    throw createActorInvocationTimeout(options, timeoutMilliseconds, cause);
  } finally {
    clearTimer();
    effectiveSignal.removeEventListener('abort', clearTimer);
  }
  if (ownedTimeoutReason !== undefined) {
    throw createActorInvocationTimeout(options, timeoutMilliseconds, ownedTimeoutReason);
  }
  return result;
}

function isAuthoritativeProtocolFailure(cause: unknown): boolean {
  return cause instanceof AgentActorError && cause.code === 'ACTOR_ENGINE_PROTOCOL_INVALID';
}

function createActorInvocationTimeout(
  options: RunActorInvocationOptions,
  timeoutMilliseconds: number,
  cause: unknown
): AgentActorError {
  return new AgentActorError(
    'ACTOR_INVOCATION_TIMEOUT',
    `Actor ${options.actorId} ${options.invocationKind} invocation exceeded ${timeoutMilliseconds} milliseconds.`,
    { cause }
  );
}
