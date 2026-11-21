import type { AgentBaseStandaloneErrorCode } from './types.js';

export class AgentBaseStandaloneError extends Error {
  readonly code: AgentBaseStandaloneErrorCode;

  constructor(
    message: string,
    options?: ErrorOptions & Readonly<{ code?: AgentBaseStandaloneErrorCode }>
  ) {
    super(message, options);
    this.name = 'AgentBaseStandaloneError';
    this.code = options?.code ?? 'STANDALONE_CONFIG_INVALID';
  }
}
