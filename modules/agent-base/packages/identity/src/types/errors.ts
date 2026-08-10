export type AgentIdentityErrorCode =
  | 'AGENT_ID_INVALID'
  | 'AGENT_DISPLAY_NAME_INVALID'
  | 'AGENT_IDENTITY_ADAPTER_RESULT_INVALID'
  | 'AGENT_IDENTITY_ALREADY_EXISTS'
  | 'AGENT_IDENTITY_NOT_FOUND'
  | 'AGENT_IDENTITY_REVISION_CONFLICT'
  | 'AGENT_IDENTITY_STATUS_TRANSITION_INVALID'
  | 'AGENT_IDENTITY_CONFIGURATION_INVALID'
  | 'AGENT_IDENTITY_PATH_INVALID'
  | 'AGENT_IDENTITY_SCHEMA_INVALID'
  | 'AGENT_IDENTITY_SCHEMA_UNSUPPORTED'
  | 'AGENT_IDENTITY_STORAGE_FAILED';

export class AgentIdentityError extends Error {
  readonly code: AgentIdentityErrorCode;

  constructor(code: AgentIdentityErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'AgentIdentityError';
    this.code = code;
  }
}
