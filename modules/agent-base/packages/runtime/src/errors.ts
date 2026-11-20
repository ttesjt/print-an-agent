export type AgentDefinitionErrorCode =
  | 'AGENT_OPERATION_NAME_INVALID'
  | 'AGENT_OPERATION_NAME_MISMATCH'
  | 'AGENT_OPERATION_REFERENCE_DUPLICATE'
  | 'AGENT_OPERATION_REFERENCE_MISMATCH'
  | 'WORKFLOW_OVERRIDE_UNKNOWN'
  | 'WORKFLOW_INPUT_PROJECTION_INVALID'
  | 'WORKFLOW_IMPLEMENTATION_MISSING'
  | 'WORKFLOW_NOT_SKIPPABLE'
  | 'WORKFLOW_NAME_MISMATCH'
  | 'WORKFLOW_PLAN_UNKNOWN'
  | 'WORKFLOW_NAME_DUPLICATE'
  | 'WORKFLOW_NAME_INVALID';

export class AgentDefinitionError extends Error {
  readonly code: AgentDefinitionErrorCode;
  readonly subjectName: string;

  constructor(code: AgentDefinitionErrorCode, subjectName: string, message: string) {
    super(message);
    this.name = 'AgentDefinitionError';
    this.code = code;
    this.subjectName = subjectName;
  }
}

export type AgentRunErrorCode =
  | 'AGENT_OPERATION_INVOCATION_CYCLE'
  | 'AGENT_OPERATION_NOT_CALLABLE'
  | 'AGENT_OPERATION_NOT_PUBLIC'
  | 'AGENT_OPERATION_NOT_REGISTERED'
  | 'AGENT_RUN_CONTEXT_BASE_REPLACED'
  | 'AGENT_RUN_EXECUTION_INCOMPLETE'
  | 'AGENT_RUN_EXECUTION_MISSING'
  | 'AGENT_RUN_EXECUTION_REENTERED'
  | 'AGENT_RUN_EXECUTION_SIGNAL_INVALID'
  | 'AGENT_RUN_OUTPUT_MISSING'
  | 'AGENT_RUN_PREPARATION_INVALID'
  | 'WORKFLOW_NOT_REGISTERED'
  | 'WORKFLOW_INPUT_PROJECTION_ASYNC'
  | 'WORKFLOW_RESULT_CONTEXT_MISMATCH';

export class AgentRunError extends Error {
  readonly code: AgentRunErrorCode;
  readonly subjectName: string | undefined;

  constructor(code: AgentRunErrorCode, message: string, subjectName?: string) {
    super(message);
    this.name = 'AgentRunError';
    this.code = code;
    this.subjectName = subjectName;
  }
}
