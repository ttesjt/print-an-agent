export type AgentSessionErrorCode =
  | 'SESSION_ID_INVALID'
  | 'TURN_ID_INVALID'
  | 'SESSION_FAILURE_CODE_INVALID'
  | 'SESSION_CONFIGURATION_INVALID'
  | 'SESSION_PATH_INVALID'
  | 'SESSION_NOT_FOUND'
  | 'TURN_ALREADY_EXISTS'
  | 'TURN_NOT_FOUND'
  | 'TURN_STATE_INVALID'
  | 'SESSION_SCHEMA_UNSUPPORTED'
  | 'SESSION_SCHEMA_INVALID'
  | 'SESSION_RECORD_INVALID'
  | 'SESSION_STORAGE_FAILED'
  | 'SESSION_COMPACTION_INVALID'
  | 'SESSION_COMPACTION_NOT_CONFIGURED'
  | 'SESSION_COMPACTION_NOT_NEEDED'
  | 'SESSION_COMPACTION_SOURCE_LIMIT_EXCEEDED'
  | 'SESSION_COMPACTION_OUTPUT_INVALID'
  | 'SESSION_COMPACTION_CANCELLED'
  | 'SESSION_COMPACTION_TIMEOUT'
  | 'SESSION_COMPACTION_RUNTIME_FAILED'
  | 'SESSION_COMPACTION_CONFLICT';

export class AgentSessionError extends Error {
  readonly code: AgentSessionErrorCode;

  constructor(code: AgentSessionErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'AgentSessionError';
    this.code = code;
  }
}

export class SessionCompactionStepNotImplementedError extends AgentSessionError {
  readonly stepName: string;

  constructor(stepName: string) {
    super(
      'SESSION_COMPACTION_NOT_CONFIGURED',
      `Session compaction step "${stepName}" requires an explicit implementation.`
    );
    this.name = 'SessionCompactionStepNotImplementedError';
    this.stepName = stepName;
  }
}
