export type ActorErrorCode =
  | 'ACTOR_ID_INVALID'
  | 'ACTOR_ENGINE_ID_INVALID'
  | 'ACTOR_DEFINITION_INVALID'
  | 'ACTOR_ENGINE_INVALID'
  | 'ACTOR_ENGINE_PROTOCOL_INVALID'
  | 'ACTOR_INVOCATION_TIMEOUT'
  | 'ACTOR_CAPABILITIES_INVALID'
  | 'ACTOR_CAPABILITY_WIDENING'
  | 'ACTOR_CATALOG_INVALID'
  | 'ACTOR_NOT_FOUND'
  | 'ACTOR_ENGINE_NOT_FOUND'
  | 'ACTOR_TOKEN_MEASUREMENT_UNAVAILABLE'
  | 'ACTOR_INVOCATION_UNSUPPORTED';

export class ActorError extends Error {
  readonly code: ActorErrorCode;

  constructor(code: ActorErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ActorError';
    this.code = code;
  }
}
