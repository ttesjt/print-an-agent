export type AgentConfigErrorCode =
  | 'CONFIG_ADAPTER_RESULT_INVALID'
  | 'CONFIG_INVALID'
  | 'CONFIG_NOT_FOUND'
  | 'CONFIG_CONFIGURATION_INVALID'
  | 'CONFIG_PATH_INVALID'
  | 'CONFIG_REVISION_CONFLICT'
  | 'CONFIG_SCHEMA_VERSION_INVALID'
  | 'CONFIG_SCHEMA_VERSION_UNSUPPORTED'
  | 'CONFIG_SIZE_LIMIT_EXCEEDED'
  | 'CONFIG_SNAPSHOT_IDENTITY_MISMATCH'
  | 'CONFIG_STORAGE_FAILED'
  | 'CONFIG_STORAGE_SCHEMA_INVALID'
  | 'CONFIG_STORAGE_SCHEMA_UNSUPPORTED';

export class AgentConfigError extends Error {
  readonly code: AgentConfigErrorCode;

  constructor(code: AgentConfigErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'AgentConfigError';
    this.code = code;
  }
}
