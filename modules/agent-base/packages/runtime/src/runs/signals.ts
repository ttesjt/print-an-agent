import { composeExecutionSignal } from '@print-an-agent/workflow-core';

import { AgentRunError } from '../errors.js';

export function resolveOperationParentSignal(
  operationName: string,
  lineageSignal: AbortSignal | undefined,
  invocationSignal: AbortSignal | undefined
): AbortSignal {
  if (
    (lineageSignal !== undefined && !(lineageSignal instanceof AbortSignal)) ||
    (invocationSignal !== undefined && !(invocationSignal instanceof AbortSignal))
  ) {
    throw new AgentRunError(
      'AGENT_RUN_EXECUTION_SIGNAL_INVALID',
      `Agent Operation "${operationName}" received an invalid invocation signal.`,
      operationName
    );
  }
  if (lineageSignal === undefined) return invocationSignal ?? new AbortController().signal;
  if (invocationSignal === undefined) return lineageSignal;
  return composeExecutionSignal([lineageSignal, invocationSignal]);
}
