import type {
  ActorInteractionRequest,
  InteractionTools,
  ModelMessage,
  UserModelMessage,
} from '@print-an-agent/model-invocation-core';

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
