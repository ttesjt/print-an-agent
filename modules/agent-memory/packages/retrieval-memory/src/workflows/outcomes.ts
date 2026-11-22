import type { StepExecutor, WorkflowLifecycle } from '@print-an-agent/workflow-core';
import type { CommitEvidence } from '../types/publication.js';
import { RetrievalMemoryError } from '../errors.js';
import { parseRetrievalReceipt } from '../persistence/index.js';
import type { CommittedRunState } from './shared/types/commit.js';

export function createSkippedRetrievalResult() {
  return { status: 'skipped' as const, reason: 'Workflow condition skipped execution.' };
}

export function preserveRetrievalCommit(cause: unknown, state: CommittedRunState): unknown {
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
      throw preserveRetrievalCommit(cause, execution.context.state);
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
      throw preserveRetrievalCommit(cause, context.state);
    }
  };
  return {
    ...hooks,
    onSuccess: (context) => invoke(hooks.onSuccess, context),
    onFinally: (context) => invoke(hooks.onFinally, context),
  };
}
