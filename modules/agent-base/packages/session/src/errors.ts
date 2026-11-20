import type { AgentSessionErrorCode } from './types/errors.js';

export class AgentSessionError extends Error {
  readonly code: AgentSessionErrorCode;

  constructor(code: AgentSessionErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'AgentSessionError';
    this.code = code;
  }
}
