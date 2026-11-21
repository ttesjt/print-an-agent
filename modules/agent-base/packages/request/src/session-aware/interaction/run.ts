import {
  createInteractionEventAccounting,
  InteractionEventDelivery,
  type RequestInteractionState,
} from '../../interaction/index.js';
import {
  traceAgentLoopCompleted,
  traceAgentLoopFailed,
  traceAgentLoopStarted,
  traceModelInteractionEvent,
} from '../tracing.js';
import type { DefaultRequestWorkflowContext } from '../types/workflow.js';

export async function runAgentInteraction(context: DefaultRequestWorkflowContext): Promise<void> {
  const accountEvent = createInteractionEventAccounting(context);
  const delivery = new InteractionEventDelivery({
    signal: context.signal,
    capacity: context.resources.policy.maxPendingInteractionEvents,
    dispatch: async (event) => {
      accountEvent(event);
      await traceModelInteractionEvent(context, event);
      delivery.assertHealthy();
      await context.runStep('dispatchInteractionEvent');
    },
  });
  context.state.interaction = Object.seal({
    signal: delivery.signal,
    emit: delivery.emit,
    stop: (cause: unknown) => delivery.stop(cause),
    get currentEvent() {
      return delivery.currentEvent;
    },
    result: undefined,
  } satisfies RequestInteractionState);
  let failure: { readonly cause: unknown } | undefined;
  let loopStarted = false;
  let toolsCloseAttempted = false;
  const closeTools = (): void => {
    if (toolsCloseAttempted) return;
    toolsCloseAttempted = true;
    context.state.tools?.close();
  };
  try {
    delivery.assertHealthy();
    await context.runStep('openResponseStream');
    delivery.assertHealthy();
    loopStarted = true;
    await traceAgentLoopStarted(context);
    delivery.assertHealthy();
    await context.runStep('invokeActorInteraction');
    await delivery.finish();
    closeTools();
    await traceAgentLoopCompleted(context);
    loopStarted = false;
    delivery.assertHealthy();
    await context.runStep('buildAgentResponse');
    delivery.assertHealthy();
  } catch (cause: unknown) {
    const error = delivery.stop(cause);
    failure = { cause: error };
    // No OutputSink.fail()/Session failure cleanup can race accepted writes after this drains.
    await delivery.drain();
    if (loopStarted) {
      try {
        await traceAgentLoopFailed(context, error);
      } catch (traceError: unknown) {
        failure = {
          cause: new AggregateError([error, traceError], 'Interaction failure tracing failed.', {
            cause: error,
          }),
        };
      }
    }
  } finally {
    delivery.dispose();
    delete context.state.capturedReasoning;
    delete context.state.turnPresentation;
  }
  try {
    closeTools();
  } catch (cleanupError: unknown) {
    failure = {
      cause:
        failure === undefined
          ? cleanupError
          : new AggregateError(
              [failure.cause, cleanupError],
              'Interaction failed and Tool cleanup also failed.',
              { cause: failure.cause }
            ),
    };
  }
  if (failure !== undefined) throw failure.cause;
}
