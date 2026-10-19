import type { StepExecutor } from '@ta-agent/workflow-core';
import { ContextMemoryError } from '../errors.js';
import { parseMemoryReceipt } from '../validation/receipt.js';

/** A returned mutation receipt is authoritative even if an enclosing extension fails afterwards. */
export function preserveMemoryCommit(cause: unknown, result: unknown): unknown {
  if (cause instanceof ContextMemoryError && cause.commit?.status === 'committed') return cause;
  if (
    typeof result !== 'object' ||
    result === null ||
    !('status' in result) ||
    (result.status !== 'committed' && result.status !== 'unchanged') ||
    !('receipt' in result)
  )
    return cause;
  const receipt = parseMemoryReceipt(result.receipt);
  return new ContextMemoryError(
    cause instanceof ContextMemoryError ? cause.code : 'CLEANUP_FAILED',
    cause instanceof ContextMemoryError
      ? cause.message
      : 'Memory committed but Workflow post-processing failed.',
    {
      memoryId: receipt.memoryId,
      cause,
      ...(cause instanceof ContextMemoryError ? { details: cause.details } : {}),
      commit: { status: 'committed', receipt },
    }
  );
}

export function memoryExecutor<N extends string, C extends { result: unknown }>(
  executor?: StepExecutor<N, C>
): StepExecutor<N, C> {
  return async (execution) => {
    try {
      if (executor === undefined) await execution.step(execution.context);
      else await executor(execution);
    } catch (cause) {
      throw preserveMemoryCommit(cause, execution.context.result);
    }
  };
}
