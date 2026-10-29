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
    cause.commit.status !== 'not-committed' &&
    state.receipt === undefined
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
  accept: (commit: CommitEvidence) => boolean = () => true
): CommitEvidence | undefined {
  const pending: unknown[] = [error];
  const seen = new Set<Error>();
  let result: CommitEvidence | undefined;
  while (pending.length !== 0) {
    const cause = pending.pop();
    if (!(cause instanceof Error) || seen.has(cause)) continue;
    seen.add(cause);
    const own = cause instanceof RetrievalMemoryError ? cause.commit : undefined;
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
