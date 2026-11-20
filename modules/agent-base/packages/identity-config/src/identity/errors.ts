import type { AgentIdentityErrorCode } from './types/errors.js';

export class AgentIdentityError extends Error {
  readonly code: AgentIdentityErrorCode;

  constructor(code: AgentIdentityErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'AgentIdentityError';
    this.code = code;
  }
}
