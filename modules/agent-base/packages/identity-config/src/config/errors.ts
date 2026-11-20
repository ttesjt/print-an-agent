import type { AgentConfigErrorCode } from './types/errors.js';

export class AgentConfigError extends Error {
  readonly code: AgentConfigErrorCode;

  constructor(code: AgentConfigErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'AgentConfigError';
    this.code = code;
  }
}
