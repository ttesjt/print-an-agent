export type AgentConfigErrorCode =
  | 'CONFIG_ADAPTER_RESULT_INVALID'
  | 'CONFIG_INVALID'
  | 'CONFIG_NOT_FOUND'
  | 'CONFIG_REVISION_CONFLICT'
  | 'CONFIG_SCHEMA_VERSION_INVALID'
  | 'CONFIG_SCHEMA_VERSION_UNSUPPORTED'
  | 'CONFIG_SNAPSHOT_IDENTITY_MISMATCH';

export class AgentConfigError extends Error {
  readonly code: AgentConfigErrorCode;

  constructor(code: AgentConfigErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'AgentConfigError';
    this.code = code;
  }
}
