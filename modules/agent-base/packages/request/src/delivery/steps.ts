import type { ModelInteractionEvent } from '@print-an-agent/model-invocation-core';
import type { OutputStreamEvent } from '../contracts.js';
import { AgentRequestError } from '../errors.js';
import { requireValue } from '../preparation/state-value.js';

export interface DeltaDeliveryContext {
  readonly state: {
    readonly interaction?: { readonly currentEvent: ModelInteractionEvent | undefined };
    readonly request?: {
      readonly outputSink?: { readonly write: (event: OutputStreamEvent) => Promise<void> };
    };
  };
}

async function deliverDelta(context: DeltaDeliveryContext, type: OutputStreamEvent['type']) {
  const event = context.state.interaction?.currentEvent;
  if (event?.type !== type) {
    throw new AgentRequestError(
      'REQUEST_INTERACTION_EVENT_INVALID',
      `Delta delivery requires a current "${type}" event.`
    );
  }
  const request = requireValue(context.state.request, 'request');
  try {
    await request.outputSink?.write(Object.freeze({ type: event.type, delta: event.delta }));
  } catch (cause: unknown) {
    throw new AgentRequestError('REQUEST_OUTPUT_FAILED', 'OutputSink failed to write.', { cause });
  }
}

export function deliverTextDelta(context: DeltaDeliveryContext): Promise<void> {
  return deliverDelta(context, 'text-delta');
}

export function deliverReasoningDelta(context: DeltaDeliveryContext): Promise<void> {
  return deliverDelta(context, 'reasoning-delta');
}
