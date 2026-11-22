import { runWithExecutionTimeout } from '@print-an-agent/workflow-core';
import { assertNotAborted, RetrievalMemoryError } from '../../errors.js';
import type { RetrievalExecutionPolicy } from './types/execution.js';
import { DEFAULT_RETRIEVAL_EXECUTION_POLICY } from './execution-policy.js';

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
