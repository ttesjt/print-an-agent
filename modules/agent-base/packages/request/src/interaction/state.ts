import type { ModelInteractionEvent } from '@print-an-agent/model-invocation-core';
import { AgentRequestError } from '../errors.js';
import type { RequestInteractionState } from './types.js';

export function requireInteraction(context: {
  readonly state: { readonly interaction?: RequestInteractionState };
}): RequestInteractionState {
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
