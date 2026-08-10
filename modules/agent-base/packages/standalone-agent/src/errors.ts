export type AgentBaseStandaloneErrorCode =
  | 'STANDALONE_CONFIG_INVALID'
  | 'STANDALONE_ROOT_INVALID'
  | 'STANDALONE_AGENT_ALREADY_EXISTS'
  | 'STANDALONE_AGENT_NOT_FOUND'
  | 'STANDALONE_AGENT_DISABLED'
  | 'STANDALONE_AGENT_STORAGE_INVALID'
  | 'STANDALONE_AGENT_STORAGE_FAILED';

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
