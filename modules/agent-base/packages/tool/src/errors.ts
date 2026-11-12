import type { ModelToolProtocolErrorCode } from '@print-an-agent/model-invocation-core';

export type AgentToolErrorCode =
  | ModelToolProtocolErrorCode
  | 'TOOL_DEFINITION_INVALID'
  | 'TOOL_SCHEMA_INVALID'
  | 'TOOL_REGISTRY_DUPLICATE'
  | 'TOOL_POLICY_INVALID'
  | 'TOOL_EXECUTION_POLICY_INVALID'
  | 'TOOL_RUN_CLOSED'
  | 'TOOL_CALL_ID_INVALID'
  | 'TOOL_CALL_DUPLICATE'
  | 'TOOL_CALL_BUDGET_EXCEEDED'
  | 'TOOL_ARGUMENTS_TOO_LARGE'
  | 'TOOL_EXECUTION_CANCELLED'
  | 'TOOL_EXECUTION_TIMEOUT'
  | 'TOOL_RESULT_INVALID'
  | 'TOOL_RESULT_TOO_LARGE'
  | 'TOOL_TOTAL_RESULT_BUDGET_EXCEEDED';

export class AgentToolError extends Error {
  readonly code: AgentToolErrorCode;

  constructor(code: AgentToolErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'AgentToolError';
    this.code = code;
  }
}
