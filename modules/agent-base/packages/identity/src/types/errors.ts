export type AgentIdentityErrorCode = 'AGENT_ID_INVALID' | 'AGENT_DISPLAY_NAME_INVALID';

export class AgentIdentityError extends Error {
  readonly code: AgentIdentityErrorCode;

  constructor(code: AgentIdentityErrorCode, message: string) {
    super(message);
    this.name = 'AgentIdentityError';
    this.code = code;
  }
}
