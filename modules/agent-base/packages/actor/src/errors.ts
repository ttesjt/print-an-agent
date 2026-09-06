export type AgentActorErrorCode =
  | 'ACTOR_ID_INVALID'
  | 'ACTOR_ENGINE_ID_INVALID'
  | 'RESPONSIBILITY_ID_INVALID'
  | 'ACTOR_DEFINITION_INVALID'
  | 'ACTOR_ENGINE_INVALID'
  | 'ACTOR_ENGINE_PROTOCOL_INVALID'
  | 'ACTOR_CAPABILITIES_INVALID'
  | 'ACTOR_CAPABILITY_WIDENING'
  | 'ACTOR_CATALOG_INVALID'
  | 'ACTOR_NOT_FOUND'
  | 'ACTOR_ENGINE_NOT_FOUND'
  | 'ACTOR_INVOCATION_UNSUPPORTED'
  | 'RESPONSIBILITY_DEFINITION_INVALID'
  | 'RESPONSIBILITY_CATALOG_INVALID'
  | 'RESPONSIBILITY_NOT_FOUND'
  | 'RESPONSIBILITY_UNAVAILABLE'
  | 'RESPONSIBILITY_CAPABILITY_UNAVAILABLE';

export class AgentActorError extends Error {
  readonly code: AgentActorErrorCode;

  constructor(code: AgentActorErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'AgentActorError';
    this.code = code;
  }
}
