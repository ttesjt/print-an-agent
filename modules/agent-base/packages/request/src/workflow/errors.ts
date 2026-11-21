import type { RequestLeafStepName } from './names.js';

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
