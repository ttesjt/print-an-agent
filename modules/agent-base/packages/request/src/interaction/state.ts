import type {
  ModelInteractionEvent,
  ModelInteractionEventSink,
  ModelInteractionResult,
} from '@ta-agent/model-invocation-core';
import type { DefaultRequestWorkflowContext } from '../default/context.js';
import { AgentRequestError } from '../errors.js';

/** Shared interaction state; currentEvent is available only during its awaited dispatch. */
export interface RequestInteractionState {
  readonly signal: AbortSignal;
  readonly emit: ModelInteractionEventSink;
  /** Stop ingress/cancel delivery without releasing already accepted work. */
  readonly stop: (cause: unknown) => unknown;
  readonly currentEvent: ModelInteractionEvent | undefined;
  result: ModelInteractionResult | undefined;
}

export function requireInteraction(
  context: DefaultRequestWorkflowContext
): RequestInteractionState {
  if (context.state.interaction === undefined) {
    throw new AgentRequestError(
      'REQUEST_INTERACTION_STATE_INVALID',
      'Request interaction has not been opened.'
    );
  }
  return context.state.interaction;
}

export function requireInteractionEvent<T extends ModelInteractionEvent['type']>(
  context: {
    readonly state: { readonly interaction?: Pick<RequestInteractionState, 'currentEvent'> };
  },
  type: T
): Extract<ModelInteractionEvent, { readonly type: T }> {
  const event = context.state.interaction?.currentEvent;
  if (event === undefined || event.type !== type) {
    throw new AgentRequestError(
      'REQUEST_INTERACTION_EVENT_INVALID',
      `Interaction Step requires a current "${type}" event.`
    );
  }
  return event as Extract<ModelInteractionEvent, { readonly type: T }>;
}
