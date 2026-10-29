import type { StepExecutor } from '@ta-agent/workflow-core';
import { ContextMemoryError } from '../errors.js';
import { parseMemoryReceipt } from '../validation/receipt.js';
import type { CommitStatus } from '../contracts/receipt.js';
import { canonicalJson, jsonValue } from '../validation/value.js';

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

/** Filter evidence before ranking it; unrelated outer receipts must not hide matching causes. */
export function findContextMemoryCommit(
  error: unknown,
  accept: (commit: CommitStatus) => boolean = () => true
): CommitStatus | undefined {
  const pending: unknown[] = [error];
  const seen = new Set<Error>();
  let result: CommitStatus | undefined;
  while (pending.length !== 0) {
    const cause = pending.pop();
    if (!(cause instanceof Error) || seen.has(cause)) continue;
    seen.add(cause);
    const own = cause instanceof ContextMemoryError ? cause.commit : undefined;
    if (own !== undefined && accept(own)) {
      if (own.status === 'committed') return own;
      if (result === undefined || own.status === 'unknown') result = own;
    }
    const children: unknown[] =
      cause instanceof AggregateError
        ? [...(cause.errors as unknown[]), cause.cause]
        : [cause.cause];
    pending.push(...children.reverse());
  }
  return result;
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
