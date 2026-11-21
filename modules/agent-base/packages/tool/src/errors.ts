import type { AgentToolErrorCode } from './types/errors.js';

export class AgentToolError extends Error {
  readonly code: AgentToolErrorCode;

  constructor(code: AgentToolErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'AgentToolError';
    this.code = code;
  }
}
