export type AgentSessionErrorCode =
  | 'SESSION_ID_INVALID'
  | 'TURN_ID_INVALID'
  | 'SESSION_NOT_FOUND'
  | 'TURN_ALREADY_EXISTS'
  | 'TURN_NOT_FOUND'
  | 'TURN_STATE_INVALID';

export class AgentSessionError extends Error {
  readonly code: AgentSessionErrorCode;

  constructor(code: AgentSessionErrorCode, message: string) {
    super(message);
    this.name = 'AgentSessionError';
    this.code = code;
  }
}
