import type { ToolHandlerResult } from '../contracts.js';
import type { ToolExecutionOutcome } from '@print-an-agent/model-invocation-core';
import { AgentToolError } from '../errors.js';

/** Cancellation is cooperative: do not release the caller until the handler has settled. */
export async function executeToolHandler(
  parentSignal: AbortSignal,
  timeoutMilliseconds: number,
  execute: (signal: AbortSignal) => Promise<ToolHandlerResult>
): Promise<ToolExecutionOutcome> {
  const timeout = new AbortController();
  const timeoutFailure = new AgentToolError(
    'TOOL_EXECUTION_TIMEOUT',
    'Tool execution exceeded its deadline.'
  );
  const signal = AbortSignal.any([parentSignal, timeout.signal]);
  const cancellationFailure = (cause: unknown) =>
    signal.reason === timeoutFailure
      ? timeoutFailure
      : new AgentToolError('TOOL_EXECUTION_CANCELLED', 'Tool execution was cancelled.', { cause });
  if (signal.aborted) throw cancellationFailure(signal.reason);

  const timer = setTimeout(() => timeout.abort(timeoutFailure), timeoutMilliseconds);
  const clearTimer = () => clearTimeout(timer);
  signal.addEventListener('abort', clearTimer, { once: true });
  try {
    let result: ToolHandlerResult;
    try {
      result = await execute(signal);
    } catch (cause: unknown) {
      if (signal.aborted) throw cancellationFailure(cause);
      return { status: 'handler-error', text: 'Tool execution failed.' };
    }
    if (signal.aborted) throw cancellationFailure(signal.reason);
    if (typeof result !== 'object' || result === null || typeof result.text !== 'string') {
      throw new AgentToolError('TOOL_RESULT_INVALID', 'Tool result must contain text.');
    }
    return { status: 'success', text: result.text };
  } finally {
    clearTimer();
    signal.removeEventListener('abort', clearTimer);
  }
}
