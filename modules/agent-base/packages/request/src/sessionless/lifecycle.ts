import type { ActorDirectResult } from '@print-an-agent/model-invocation-core';
import type { WorkflowLifecycle } from '@print-an-agent/workflow-core';
import {
  publishOutput,
  requireCompletedSessionlessResponse,
  sessionlessOutputFailure,
} from './output.js';
import type { SessionlessValidatedRequest } from './types/input.js';
import type { SessionlessOutputOutcome } from './types/output.js';

interface SessionlessLifecycleContext {
  readonly state: {
    readonly request?: SessionlessValidatedRequest;
    readonly completedResponse?: ActorDirectResult;
    outputOutcome?: SessionlessOutputOutcome;
  };
}

/** Guaranteed cleanup is lifecycle machinery, not a skippable business Step. */
export function sessionlessLifecycle<C extends SessionlessLifecycleContext>(
  input: WorkflowLifecycle<C> | undefined,
  cleanup?: (context: C) => void
): WorkflowLifecycle<C> {
  const lifecycle = Object.freeze({ ...input });
  return {
    async onSuccess(context) {
      requireCompletedSessionlessResponse(context.state);
      await lifecycle.onSuccess?.(context);
    },
    async onError(context, cause) {
      const errors: unknown[] = [];
      try {
        cleanup?.(context);
      } catch (error) {
        errors.push(error);
      }
      const sink = context.state.request?.outputSink;
      try {
        if (sink !== undefined && context.state.outputOutcome === undefined) {
          // Claim terminal delivery before awaiting I/O; a closed channel cannot be retracted.
          context.state.outputOutcome = 'failure-attempted';
          await publishOutput(() => sink.fail(sessionlessOutputFailure(cause)), 'fail');
        }
      } catch (error) {
        errors.push(error);
      }
      try {
        await lifecycle.onError?.(context, cause);
      } catch (error) {
        errors.push(error);
      }
      if (errors.length > 0)
        throw new AggregateError(errors, 'Sessionless failure cleanup failed.');
    },
    async onFinally(context) {
      const errors: unknown[] = [];
      try {
        cleanup?.(context);
      } catch (error) {
        errors.push(error);
      }
      try {
        await lifecycle.onFinally?.(context);
      } catch (error) {
        errors.push(error);
      }
      if (errors.length > 0) throw new AggregateError(errors, 'Sessionless final cleanup failed.');
    },
  };
}
