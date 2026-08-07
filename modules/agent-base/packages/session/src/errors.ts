export type AgentSessionErrorCode =
  | 'SESSION_ID_INVALID'
  | 'TURN_ID_INVALID'
  | 'SESSION_FAILURE_CODE_INVALID'
  | 'SESSION_CONFIGURATION_INVALID'
  | 'SESSION_PATH_INVALID'
  | 'SESSION_NOT_FOUND'
  | 'TURN_ALREADY_EXISTS'
  | 'TURN_NOT_FOUND'
  | 'TURN_STATE_INVALID'
  | 'SESSION_SCHEMA_UNSUPPORTED'
  | 'SESSION_SCHEMA_INVALID'
  | 'SESSION_RECORD_INVALID'
  | 'SESSION_STORAGE_FAILED';

export class AgentSessionError extends Error {
  readonly code: AgentSessionErrorCode;

  constructor(code: AgentSessionErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'AgentSessionError';
    this.code = code;
  }
}
