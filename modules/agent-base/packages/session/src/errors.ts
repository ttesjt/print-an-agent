export type AgentSessionErrorCode =
  | 'SESSION_MEMORY_INVALID'
  | 'SESSION_MEMORY_CONFLICT'
  | 'SESSION_MEMORY_PENDING'
  | 'SESSION_MEMORY_CLEANUP_FAILED'
  | 'SESSION_MEMORY_NOT_CONFIGURED'
  | 'SESSION_LIFECYCLE_INVALID'
  | 'SESSION_RETIRED'
  | 'SESSION_ALREADY_RETIRED'
  | 'SESSION_NOT_RETIRED'
  | 'SESSION_BUSY'
  | 'SESSION_EXECUTION_INVALID'
  | 'SESSION_EXECUTION_STALE'
  | 'SESSION_EXECUTION_CONFLICT'
  | 'SESSION_RECOVERY_FAILED'
  | 'SESSION_PURGE_INVALID'
  | 'SESSION_PURGE_FAILED'
  | 'SESSION_PRESENTATION_INVALID'
  | 'SESSION_PRESENTATION_LIMIT_EXCEEDED'
  | 'SESSION_PRESENTATION_NOT_CONFIGURED'
  | 'SESSION_ID_INVALID'
  | 'SESSION_ID_CONFLICT'
  | 'SESSION_BRANCH_ID_INVALID'
  | 'TURN_ID_INVALID'
  | 'SESSION_FAILURE_CODE_INVALID'
  | 'SESSION_CONFIGURATION_INVALID'
  | 'SESSION_QUERY_INVALID'
  | 'SESSION_METADATA_INVALID'
  | 'SESSION_METADATA_CONFLICT'
  | 'SESSION_PATH_INVALID'
  | 'SESSION_NOT_FOUND'
  | 'TURN_ALREADY_EXISTS'
  | 'TURN_NOT_FOUND'
  | 'TURN_STATE_INVALID'
  | 'SESSION_SCHEMA_UNSUPPORTED'
  | 'SESSION_SCHEMA_INVALID'
  | 'SESSION_RECORD_INVALID'
  | 'SESSION_STORAGE_FAILED'
  | 'SESSION_NAVIGATION_INVALID'
  | 'SESSION_NAVIGATION_NOT_CONFIGURED'
  | 'SESSION_NAVIGATION_CONFLICT'
  | 'SESSION_NAVIGATION_CANCELLED'
  | 'SESSION_BRANCH_NOT_FOUND'
  | 'SESSION_BRANCH_ALREADY_EXISTS'
  | 'SESSION_BRANCH_BUSY'
  | 'SESSION_NAVIGATION_TARGET_INVALID'
  | 'SESSION_COMPACTION_INVALID'
  | 'SESSION_COMPACTION_NOT_CONFIGURED'
  | 'SESSION_COMPACTION_NOT_NEEDED'
  | 'SESSION_COMPACTION_SOURCE_LIMIT_EXCEEDED'
  | 'SESSION_COMPACTION_OUTPUT_INVALID'
  | 'SESSION_COMPACTION_TOKENIZER_NOT_CONFIGURED'
  | 'SESSION_COMPACTION_TOKENIZER_FAILED'
  | 'SESSION_COMPACTION_MEASUREMENT_INEXACT'
  | 'SESSION_COMPACTION_ATTEMPTS_EXHAUSTED'
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

export class SessionNavigationStepNotImplementedError extends AgentSessionError {
  readonly stepName: string;

  constructor(stepName: string) {
    super(
      'SESSION_NAVIGATION_NOT_CONFIGURED',
      `Session navigation step "${stepName}" requires an explicit implementation.`
    );
    this.name = 'SessionNavigationStepNotImplementedError';
    this.stepName = stepName;
  }
}
