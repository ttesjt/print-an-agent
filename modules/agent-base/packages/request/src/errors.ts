import type { RequestLeafStepName } from './workflow/names.js';

export type AgentRequestErrorCode =
  | 'REQUEST_INPUT_INVALID'
  | 'REQUEST_POLICY_INVALID'
  | 'REQUEST_INSTRUCTIONS_INVALID'
  | 'REQUEST_CONTEXT_INCOMPLETE'
  | 'REQUEST_OUTPUT_STATE_INVALID'
  | 'REQUEST_OUTPUT_FAILED'
  | 'REQUEST_TIMEOUT';

export class AgentRequestError extends Error {
  readonly code: AgentRequestErrorCode;

  constructor(code: AgentRequestErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'AgentRequestError';
    this.code = code;
  }
}

export class RequestStepNotImplementedError extends Error {
  readonly code = 'REQUEST_STEP_NOT_IMPLEMENTED';
  readonly stepName: RequestLeafStepName;

  constructor(stepName: RequestLeafStepName) {
    super(
      `Request Step "${stepName}" has no implementation. Supply an explicit Step override before running this Workflow.`
    );
    this.name = 'RequestStepNotImplementedError';
    this.stepName = stepName;
  }
}
