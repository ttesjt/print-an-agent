import type { AgentRequestErrorCode } from './types.js';

export class AgentRequestError extends Error {
  readonly code: AgentRequestErrorCode;

  constructor(code: AgentRequestErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'AgentRequestError';
    this.code = code;
  }
}
