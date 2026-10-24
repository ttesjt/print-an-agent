import type { StepExecutor, WorkflowLifecycle } from '@ta-agent/workflow-core';
import type { RetrievalReceipt, CommitEvidence } from '../contracts/publication.js';
import { RetrievalMemoryError } from '../errors.js';
import { parseRetrievalReceipt } from '../domain/receipts.js';
export interface CommittedRunState {
  receipt?: RetrievalReceipt;
}
function preserve(cause: unknown, state: CommittedRunState): unknown {
  if (
    cause instanceof RetrievalMemoryError &&
    cause.commit !== undefined &&
    cause.commit.status !== 'not-committed'
  )
    return cause;
  const commit: CommitEvidence =
    state.receipt === undefined
      ? { status: 'not-committed' }
      : { status: 'committed', receipt: parseRetrievalReceipt(state.receipt) };
  return new RetrievalMemoryError(
    cause instanceof RetrievalMemoryError ? cause.code : 'CLEANUP_FAILED',
    state.receipt === undefined
      ? 'Memory operation failed before commit.'
      : 'Memory committed, but Workflow post-processing failed.',
    { cause, commit }
  );
}
export function retrievalExecutor<N extends string, C extends { state: CommittedRunState }>(
  executor?: StepExecutor<N, C>
): StepExecutor<N, C> {
  return async (execution) => {
    try {
      if (executor === undefined) await execution.step(execution.context);
      else await executor(execution);
    } catch (cause) {
      throw preserve(cause, execution.context.state);
    }
  };
}
export function retrievalLifecycle<C extends { state: CommittedRunState }>(
  hooks: WorkflowLifecycle<C> = {}
): WorkflowLifecycle<C> {
  const invoke = async (hook: ((context: C) => void | Promise<void>) | undefined, context: C) => {
    try {
      await hook?.(context);
    } catch (cause) {
      throw preserve(cause, context.state);
    }
  };
  return {
    ...hooks,
    onSuccess: (context) => invoke(hooks.onSuccess, context),
    onFinally: (context) => invoke(hooks.onFinally, context),
  };
}
/** Native Workflow may aggregate independent hook/protocol failures; inspect facts without discarding them. */
export function findRetrievalCommit(
  error: unknown,
  seen = new Set<object>()
): CommitEvidence | undefined {
  if (!(error instanceof Error) || seen.has(error)) return undefined;
  seen.add(error);
  const own = error instanceof RetrievalMemoryError ? error.commit : undefined;
  if (own?.status === 'committed') return own;
  const children: unknown[] =
    error instanceof AggregateError ? [...(error.errors as unknown[]), error.cause] : [error.cause];
  let result = own;
  for (const child of children) {
    const found = findRetrievalCommit(child, seen);
    if (found?.status === 'committed') return found;
    if (found?.status === 'unknown' || result === undefined) result = found;
  }
  return result;
}
