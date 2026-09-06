export type AgentModelErrorCode =
  | 'MODEL_REFERENCE_INVALID'
  | 'MODEL_EXECUTION_PROVENANCE_INVALID'
  | 'MODEL_MESSAGE_INVALID'
  | 'MODEL_PROVIDER_NOT_FOUND'
  | 'MODEL_TARGET_NOT_FOUND'
  | 'MODEL_CREDENTIAL_NOT_FOUND'
  | 'MODEL_CREDENTIAL_RESOLUTION_FAILED'
  | 'MODEL_PROVIDER_FAILED'
  | 'MODEL_INVOCATION_CANCELLED'
  | 'MODEL_INVOCATION_TIMEOUT'
  | 'MODEL_OUTPUT_LIMIT_EXCEEDED'
  | 'MODEL_TURN_LIMIT_EXCEEDED'
  | 'MODEL_RUNTIME_PROTOCOL_INVALID';

export class AgentModelError extends Error {
  readonly code: AgentModelErrorCode;

  constructor(code: AgentModelErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'AgentModelError';
    this.code = code;
  }
}
