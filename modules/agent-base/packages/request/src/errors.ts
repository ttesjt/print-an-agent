import type { RequestLeafStepName } from './workflow/names.js';

export type AgentRequestErrorCode =
  | 'REQUEST_INPUT_INVALID'
  | 'REQUEST_CONFIGURATION_INVALID'
  | 'REQUEST_POLICY_INVALID'
  | 'REQUEST_INSTRUCTIONS_INVALID'
  | 'REQUEST_CONTEXT_INCOMPLETE'
  | 'REQUEST_INTERACTION_STATE_INVALID'
  | 'REQUEST_INTERACTION_EVENT_INVALID'
  | 'REQUEST_INTERACTION_EVENT_QUEUE_FULL'
  | 'REQUEST_INTERACTION_EVENT_DELIVERY_CLOSED'
  | 'REQUEST_OUTPUT_STATE_INVALID'
  | 'REQUEST_OUTPUT_FAILED'
  | 'REQUEST_TIMEOUT'
  | 'REQUEST_IDEMPOTENCY_KEY_INVALID'
  | 'REQUEST_REPLAY_FINGERPRINT_INVALID'
  | 'REQUEST_REPLAY_REQUEST_ID_INVALID'
  | 'REQUEST_REPLAY_FAILURE_INVALID'
  | 'REQUEST_REPLAY_NOT_FOUND'
  | 'REQUEST_REPLAY_CONFLICT'
  | 'REQUEST_REPLAY_IN_PROGRESS'
  | 'REQUEST_REPLAY_FAILED'
  | 'REQUEST_REPLAY_STATE_INVALID'
  | 'REQUEST_REPLAY_CONFIGURATION_INVALID'
  | 'REQUEST_REPLAY_PATH_INVALID'
  | 'REQUEST_REPLAY_SCHEMA_UNSUPPORTED'
  | 'REQUEST_REPLAY_SCHEMA_INVALID'
  | 'REQUEST_REPLAY_RECORD_INVALID'
  | 'REQUEST_REPLAY_STORAGE_FAILED';

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
