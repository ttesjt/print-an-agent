/** Shared model-facing tool rejection codes; execution policy errors remain consumer-owned. */
export type ModelToolProtocolErrorCode = 'TOOL_NOT_AUTHORIZED' | 'TOOL_ARGUMENTS_INVALID';

export type ModelInvocationErrorCode =
  | ModelToolProtocolErrorCode
  | 'MODEL_REFERENCE_INVALID'
  | 'MODEL_EXECUTION_PROVENANCE_INVALID'
  | 'MODEL_MESSAGE_INVALID'
  | 'MODEL_PROVIDER_NOT_FOUND'
  | 'MODEL_TARGET_NOT_FOUND'
  | 'MODEL_CREDENTIAL_NOT_FOUND'
  | 'MODEL_CREDENTIAL_RESOLUTION_FAILED'
  | 'MODEL_PROVIDER_TRANSPORT_POLICY_INVALID'
  | 'MODEL_PROVIDER_RESPONSE_START_TIMEOUT'
  | 'MODEL_PROVIDER_STREAM_IDLE_TIMEOUT'
  | 'MODEL_PROVIDER_FAILED'
  | 'MODEL_INVOCATION_CANCELLED'
  | 'MODEL_INVOCATION_TIMEOUT'
  | 'MODEL_OUTPUT_LIMIT_EXCEEDED'
  | 'MODEL_REASONING_LIMIT_EXCEEDED'
  | 'MODEL_TURN_LIMIT_EXCEEDED'
  | 'MODEL_RUNTIME_PROTOCOL_INVALID';

export class ModelInvocationError extends Error {
  readonly code: ModelInvocationErrorCode;

  constructor(code: ModelInvocationErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ModelInvocationError';
    this.code = code;
  }
}
