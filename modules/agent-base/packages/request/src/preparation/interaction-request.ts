import type {
  ActorInteractionRequest,
  ModelInteractionEvent,
  ModelMessage,
  UserModelMessage,
  InteractionTools,
} from '@ta-agent/model-invocation-core';
import { requireValue } from './state-value.js';

export interface InteractionRequestContext {
  readonly signal: AbortSignal;
  readonly state: {
    instructions?: string;
    history?: readonly ModelMessage[];
    userMessage?: UserModelMessage;
    tools?: InteractionTools;
    modelRequest?: ActorInteractionRequest;
    interaction?: { readonly emit: ActorInteractionRequest['emit'] };
  };
  readonly resources: {
    readonly policy: Pick<ActorInteractionRequest, 'maxModelTurns' | 'maxOutputCharacters'>;
  };
}

/** Material acquisition is a separate phase; this Step only assembles the formal request. */
export function buildInteractionRequest(context: InteractionRequestContext): Promise<void> {
  context.state.modelRequest = Object.freeze({
    instructions: requireValue(context.state.instructions, 'instructions'),
    history: requireValue(context.state.history, 'history'),
    prompt: requireValue(context.state.userMessage, 'userMessage'),
    tools: requireValue(context.state.tools, 'tools'),
    maxModelTurns: context.resources.policy.maxModelTurns,
    maxOutputCharacters: context.resources.policy.maxOutputCharacters,
    signal: context.signal,
    emit: (event: ModelInteractionEvent) =>
      requireValue(context.state.interaction, 'interaction').emit(event),
  });
  return Promise.resolve();
}
