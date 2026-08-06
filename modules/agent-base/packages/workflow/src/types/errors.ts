export type AgentDefinitionErrorCode =
  | 'STEP_OVERRIDE_UNKNOWN'
  | 'STEP_IMPLEMENTATION_MISSING'
  | 'STEP_NOT_SKIPPABLE'
  | 'WORKFLOW_ENTRY_STEP_SKIPPED'
  | 'WORKFLOW_OVERRIDE_UNKNOWN'
  | 'WORKFLOW_IMPLEMENTATION_MISSING'
  | 'WORKFLOW_NOT_SKIPPABLE'
  | 'WORKFLOW_NAME_MISMATCH'
  | 'WORKFLOW_PLAN_UNKNOWN';

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
  | 'AGENT_CONTEXT_BASE_REPLACED'
  | 'AGENT_OUTPUT_MISSING'
  | 'STEP_NOT_REGISTERED'
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
