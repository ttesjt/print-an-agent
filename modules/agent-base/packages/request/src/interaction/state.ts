import type { AgentLoopEvent, AgentLoopEventSink, AgentLoopResult } from '@ta-agent/base-model';
import type { DefaultRequestWorkflowContext } from '../default/context.js';
import { AgentRequestError } from '../errors.js';

/** Shared interaction state; currentEvent is available only during its awaited dispatch. */
export interface RequestInteractionState {
  readonly signal: AbortSignal;
  readonly emit: AgentLoopEventSink;
  readonly currentEvent: AgentLoopEvent | undefined;
  result: AgentLoopResult | undefined;
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

export function requireInteractionEvent<T extends AgentLoopEvent['type']>(
  context: {
    readonly state: { readonly interaction?: Pick<RequestInteractionState, 'currentEvent'> };
  },
  type: T
): Extract<AgentLoopEvent, { readonly type: T }> {
  const event = context.state.interaction?.currentEvent;
  if (event === undefined || event.type !== type) {
    throw new AgentRequestError(
      'REQUEST_INTERACTION_EVENT_INVALID',
      `Interaction Step requires a current "${type}" event.`
    );
  }
  return event as Extract<AgentLoopEvent, { readonly type: T }>;
}
