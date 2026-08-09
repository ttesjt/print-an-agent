export type AgentBaseStandaloneErrorCode = 'STANDALONE_CONFIG_INVALID';

export class AgentBaseStandaloneError extends Error {
  readonly code: AgentBaseStandaloneErrorCode;

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'AgentBaseStandaloneError';
    this.code = 'STANDALONE_CONFIG_INVALID';
  }
}
