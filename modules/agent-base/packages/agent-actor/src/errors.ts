import type { AgentActorErrorCode } from './types.js';

export class AgentActorError extends Error {
  readonly code: AgentActorErrorCode;

  constructor(code: AgentActorErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'AgentActorError';
    this.code = code;
  }
}
