export type AgentBaseCliErrorCode =
  | 'CLI_USAGE_INVALID'
  | 'CLI_CONFIG_INVALID'
  | 'CLI_RESOURCE_CLEANUP_FAILED'
  | 'CLI_INPUT_INVALID';

export class AgentBaseCliError extends Error {
  readonly code: AgentBaseCliErrorCode;

  constructor(code: AgentBaseCliErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'AgentBaseCliError';
    this.code = code;
  }
}
