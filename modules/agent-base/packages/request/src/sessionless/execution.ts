import type { ModelInteractionEvent } from '@ta-agent/model-invocation-core';
import { InteractionEventDelivery } from '../interaction/event-delivery.js';
import type { RequestInteractionState } from '../interaction/state.js';

interface SessionlessExecutionContext {
  readonly signal: AbortSignal;
  readonly state: { interaction?: RequestInteractionState };
  readonly resources: { readonly policy: { readonly maxPendingInteractionEvents: number } };
  runStep(
    name:
      | 'dispatchModelEvent'
      | 'openResponseStream'
      | 'invokeModel'
      | 'buildResponse'
      | 'validateResponse'
      | 'completeResponse'
  ): Promise<void>;
}

/** Owns delivery, not model protocol or Session authority. Both invocation profiles use this scope. */
export async function executeSessionlessRequest(
  context: SessionlessExecutionContext,
  account?: (event: ModelInteractionEvent) => void
): Promise<void> {
  const delivery = new InteractionEventDelivery({
    signal: context.signal,
    capacity: context.resources.policy.maxPendingInteractionEvents,
    dispatch: async (event) => {
      account?.(event);
      await context.runStep('dispatchModelEvent');
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
  });
  try {
    await context.runStep('openResponseStream');
    delivery.assertHealthy();
    await context.runStep('invokeModel');
    await delivery.finish();
    await context.runStep('buildResponse');
    await context.runStep('validateResponse');
    delivery.assertHealthy();
    await context.runStep('completeResponse');
  } catch (cause) {
    const failure = delivery.stop(cause);
    await delivery.drain();
    throw failure;
  } finally {
    delivery.dispose();
  }
}
