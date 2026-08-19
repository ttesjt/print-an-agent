import { WorkbenchControlPlaneError } from '../foundation/errors.js';

export class ModelRunNotFoundError extends WorkbenchControlPlaneError {
  readonly runId: string;

  constructor(runId: string) {
    super('MODEL_RUN_NOT_FOUND', `Model Run "${runId}" does not exist.`);
    this.runId = runId;
  }
}

export class ModelRunOperationUnavailableError extends WorkbenchControlPlaneError {
  readonly runId: string;
  readonly operation: string;

  constructor(runId: string, operation: string) {
    super(
      'MODEL_RUN_OPERATION_UNAVAILABLE',
      `Model Run "${runId}" uses unavailable operation "${operation}".`
    );
    this.runId = runId;
    this.operation = operation;
  }
}

export class RunExecutionSupportMismatchError extends WorkbenchControlPlaneError {
  readonly runId: string;

  constructor(runId: string) {
    super(
      'RUN_EXECUTION_SUPPORT_MISMATCH',
      `Model Run "${runId}" cannot be observed by its frozen Runtime Support.`
    );
    this.runId = runId;
  }
}

/** The bound Execution Support could not observe its backend execution. */
export class RunObservationError extends WorkbenchControlPlaneError {
  readonly runId: string;

  constructor(runId: string, options?: ErrorOptions) {
    super('RUN_OBSERVATION_ERROR', `Model Run "${runId}" could not be observed.`, options);
    this.runId = runId;
  }
}

export class RunCancellationError extends WorkbenchControlPlaneError {
  readonly runId: string;

  constructor(runId: string, options?: ErrorOptions) {
    super('RUN_CANCELLATION_ERROR', `Model Run "${runId}" could not be cancelled.`, options);
    this.runId = runId;
  }
}
