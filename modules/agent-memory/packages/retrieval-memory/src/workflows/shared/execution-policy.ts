import { MAX_EXECUTION_TIMEOUT_MILLISECONDS } from '@print-an-agent/workflow-core';
import { fail } from '../../errors.js';
import type { RetrievalExecutionPolicy } from './types/execution.js';

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
