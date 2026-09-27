export type AgentDefinitionErrorCode =
  | 'AGENT_OPERATION_NAME_INVALID'
  | 'AGENT_OPERATION_NAME_MISMATCH'
  | 'AGENT_OPERATION_REFERENCE_DUPLICATE'
  | 'AGENT_OPERATION_REFERENCE_MISMATCH'
  | 'STEP_OVERRIDE_UNKNOWN'
  | 'STEP_DEFINITION_INVALID'
  | 'STEP_OVERRIDE_INVALID'
  | 'STEP_CARDINALITY_INVALID'
  | 'STEP_IMPLEMENTATION_MISSING'
  | 'STEP_NOT_SKIPPABLE'
  | 'WORKFLOW_ENTRY_STEP_SKIPPED'
  | 'WORKFLOW_OVERRIDE_UNKNOWN'
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
  | 'STEP_NOT_REGISTERED'
  | 'STEP_CONCURRENT_INVOCATION_NOT_ALLOWED'
  | 'STEP_CARDINALITY_EXCEEDED'
  | 'WORKFLOW_CONDITION_INVALID'
  | 'WORKFLOW_CONTEXT_BASE_REPLACED'
  | 'WORKFLOW_CONTEXT_NOT_READY'
  | 'WORKFLOW_CONTEXT_RUNNER_REPLACED'
  | 'WORKFLOW_NOT_REGISTERED'
  | 'WORKFLOW_RESULT_CONTEXT_MISMATCH'
  | 'WORKFLOW_RESULT_MISSING';

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
