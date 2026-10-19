import type { ActorDirectResult } from '@ta-agent/model-invocation-core';
import type { WorkflowLifecycle } from '@ta-agent/workflow-core';
import { AgentRequestError } from '../errors.js';
import { publishOutput, sessionlessOutputFailure } from './output.js';
import type { SessionlessOutputOutcome, SessionlessValidatedRequest } from './contracts.js';

interface SessionlessLifecycleContext {
  readonly state: {
    readonly request?: SessionlessValidatedRequest;
    outputOutcome?: SessionlessOutputOutcome;
  };
  readonly result: ActorDirectResult | undefined;
}

/** Guaranteed cleanup is lifecycle machinery, not a skippable business Step. */
export function sessionlessLifecycle<C extends SessionlessLifecycleContext>(
  input: WorkflowLifecycle<C> | undefined,
  cleanup?: (context: C) => void
): WorkflowLifecycle<C> {
  const lifecycle = Object.freeze({ ...input });
  return {
    async onSuccess(context) {
      if (context.result === undefined)
        throw new AgentRequestError(
          'REQUEST_OUTPUT_STATE_INVALID',
          'Sessionless request completed without a response.'
        );
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
