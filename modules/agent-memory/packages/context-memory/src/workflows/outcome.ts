import type { StepExecutor } from '@print-an-agent/workflow-core';
import { ContextMemoryError } from '../errors.js';
import { parseMemoryReceipt } from '../persistence/index.js';
import { canonicalJson, jsonValue } from '../values/index.js';
import type { MemoryOperationOutput } from './shared/types/output.js';

export function requireMemoryOperationOutput<O>(state: Readonly<MemoryOperationOutput<O>>): O {
  if (state.operationOutput === undefined)
    throw new ContextMemoryError('CONFIG_INVALID', 'Memory Workflow completed without an output.');
  return state.operationOutput.value;
}

/** A returned mutation receipt is authoritative even if an enclosing extension fails afterwards. */
export function preserveMemoryCommit(cause: unknown, result: unknown): unknown {
  if (typeof result !== 'object' || result === null) return cause;
  const value =
    'receipt' in result &&
    'status' in result &&
    (result.status === 'committed' || result.status === 'unchanged')
      ? result.receipt
      : 'inputDigest' in result && 'requestId' in result
        ? result
        : undefined;
  if (value === undefined) return cause;
  const receipt = parseMemoryReceipt(value);
  if (cause instanceof ContextMemoryError && cause.commit?.status === 'committed') {
    try {
      if (
        canonicalJson(jsonValue(parseMemoryReceipt(cause.commit.receipt))) ===
        canonicalJson(jsonValue(receipt))
      )
        return cause;
    } catch {
      /* Invalid or unrelated cleanup evidence cannot replace this operation's receipt. */
    }
  }
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

export function memoryExecutor<
  N extends string,
  C extends { state: MemoryOperationOutput<unknown> },
>(executor?: StepExecutor<N, C>): StepExecutor<N, C> {
  return async (execution) => {
    try {
      if (executor === undefined) await execution.step(execution.context);
      else await executor(execution);
    } catch (cause) {
      throw preserveMemoryCommit(cause, execution.context.state.operationOutput?.value);
    }
  };
}
