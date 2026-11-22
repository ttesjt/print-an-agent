import { runWithExecutionTimeout } from '@print-an-agent/workflow-core';
import type { ModelMemoryOperation } from '../../../model-update/index.js';
import { ContextMemoryError, assertMemoryNotAborted } from '../../../errors.js';
import { bindModelMemorySignal, modelMemorySignal } from './signal.js';
import type { ModelMemoryContext } from '../types/workflow.js';
import { isMemoryPlannerTimeout } from '../../../model-update/index.js';
import { preserveMemoryCommit } from '../../shared/index.js';
import { runUpdateCycles } from './update-cycle.js';

/** One domain deadline for the complete run, not a renewed timer per generation. */
export async function runModelMemory(
  context: ModelMemoryContext,
  operation: ModelMemoryOperation
): Promise<void> {
  try {
    await runWithExecutionTimeout(
      {
        parentSignal: context.signal,
        timeoutMilliseconds: context.resources.policy.timeoutMs,
        createTimeoutFailure: ({ cause }) => {
          if (isMemoryPlannerTimeout(cause)) return cause;
          const output = context.state.operationOutput?.value;
          return new ContextMemoryError(
            'OPERATION_TIMEOUT',
            'Memory operation exceeded its deadline.',
            {
              cause,
              commit:
                output !== undefined && output.status !== 'skipped'
                  ? { status: 'committed', receipt: output.receipt }
                  : cause instanceof ContextMemoryError && cause.commit !== undefined
                    ? cause.commit
                    : { status: 'not-committed' },
            }
          );
        },
      },
      async (signal) => {
        bindModelMemorySignal(context, signal);
        await runUpdateCycles(context, operation);
      }
    );
  } catch (cause) {
    const failure = preserveMemoryCommit(cause, context.state.operationOutput?.value);
    if (failure !== cause) throw failure;
    if (cause instanceof ContextMemoryError && cause.commit !== undefined) throw cause;
    assertMemoryNotAborted(modelMemorySignal(context));
    if (cause instanceof ContextMemoryError)
      throw new ContextMemoryError(cause.code, cause.message, {
        cause,
        details: cause.details,
        commit: { status: 'not-committed' },
      });
    throw cause;
  }
}
