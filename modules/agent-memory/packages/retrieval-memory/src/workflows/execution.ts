import {
  MAX_EXECUTION_TIMEOUT_MILLISECONDS,
  runWithExecutionTimeout,
} from '@print-an-agent/workflow-core';
import { assertNotAborted, fail, RetrievalMemoryError } from '../errors.js';
import type { RetrievalExecutionPolicy } from './shared/types/execution.js';

export const DEFAULT_RETRIEVAL_EXECUTION_POLICY: RetrievalExecutionPolicy = Object.freeze({
  timeoutMilliseconds: null,
});

export function defineRetrievalExecutionPolicy(
  value: RetrievalExecutionPolicy = DEFAULT_RETRIEVAL_EXECUTION_POLICY
): RetrievalExecutionPolicy {
  if (
    value.timeoutMilliseconds !== null &&
    (!Number.isSafeInteger(value.timeoutMilliseconds) ||
      value.timeoutMilliseconds < 1 ||
      value.timeoutMilliseconds > MAX_EXECUTION_TIMEOUT_MILLISECONDS)
  )
    fail('CONFIG_INVALID', 'Invalid Memory operation deadline.');
  return Object.freeze({ timeoutMilliseconds: value.timeoutMilliseconds });
}

/** Reuse Core's cooperative deadline boundary. Never race and abandon borrowed work. */
export function runRetrievalExecution(
  parentSignal: AbortSignal,
  policy: RetrievalExecutionPolicy = DEFAULT_RETRIEVAL_EXECUTION_POLICY,
  operation: (signal: AbortSignal) => Promise<void>
): Promise<void> {
  const started = performance.now();
  const timeout = () =>
    new RetrievalMemoryError('OPERATION_TIMED_OUT', 'Memory operation deadline expired.');
  return runWithExecutionTimeout(
    {
      parentSignal,
      timeoutMilliseconds: policy.timeoutMilliseconds,
      createTimeoutFailure: timeout,
    },
    async (signal) => {
      await operation(signal);
      assertNotAborted(parentSignal);
      if (
        policy.timeoutMilliseconds !== null &&
        performance.now() - started >= policy.timeoutMilliseconds
      )
        throw timeout();
    }
  );
}
