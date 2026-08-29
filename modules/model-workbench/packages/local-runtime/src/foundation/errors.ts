export class WorkbenchLocalRuntimeError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
    this.code = code;
  }
}

export class InvalidLocalRuntimeConfigurationError extends WorkbenchLocalRuntimeError {
  constructor(message: string, options?: ErrorOptions) {
    super('LOCAL_RUNTIME_CONFIGURATION_INVALID', message, options);
  }
}

export class InvalidLocalRuntimeReceiptError extends WorkbenchLocalRuntimeError {
  constructor(message: string, options?: ErrorOptions) {
    super('LOCAL_RUNTIME_RECEIPT_INVALID', message, options);
  }
}

export class LocalArtifactAccessError extends WorkbenchLocalRuntimeError {
  constructor(artifactId: string, operation: 'verify' | 'materialize', options?: ErrorOptions) {
    super(
      'LOCAL_ARTIFACT_ACCESS_FAILED',
      `Could not ${operation} local Artifact "${artifactId}".`,
      options
    );
  }
}

export class LocalArtifactDigestMismatchError extends WorkbenchLocalRuntimeError {
  constructor(artifactId: string) {
    super(
      'LOCAL_ARTIFACT_DIGEST_MISMATCH',
      `Local Artifact "${artifactId}" does not match its recorded digest.`
    );
  }
}

export class LocalExecutionObservationError extends WorkbenchLocalRuntimeError {
  constructor(message: string, options?: ErrorOptions) {
    super('LOCAL_EXECUTION_OBSERVATION_FAILED', message, options);
  }
}

export class LocalExecutionCancellationError extends WorkbenchLocalRuntimeError {
  constructor(message: string, options?: ErrorOptions) {
    super('LOCAL_EXECUTION_CANCELLATION_FAILED', message, options);
  }
}

export class InvalidLocalCommandConfigurationError extends WorkbenchLocalRuntimeError {
  constructor(message: string, options?: ErrorOptions) {
    super('LOCAL_COMMAND_CONFIGURATION_INVALID', message, options);
  }
}

export class LocalCommandDispatchError extends WorkbenchLocalRuntimeError {
  constructor(message: string, options?: ErrorOptions) {
    super('LOCAL_COMMAND_DISPATCH_FAILED', message, options);
  }
}

export class LocalOutputInvocationError extends WorkbenchLocalRuntimeError {
  constructor(message: string, options?: ErrorOptions) {
    super('LOCAL_OUTPUT_INVOCATION_FAILED', message, options);
  }
}

export class LocalCommandWorkspaceConflictError extends WorkbenchLocalRuntimeError {
  constructor(executionId: string, options?: ErrorOptions) {
    super(
      'LOCAL_COMMAND_WORKSPACE_CONFLICT',
      `Local execution "${executionId}" already exists with a different request or command.`,
      options
    );
  }
}

export class LocalSupervisorError extends WorkbenchLocalRuntimeError {
  constructor(message: string, options?: ErrorOptions) {
    super('LOCAL_SUPERVISOR_FAILED', message, options);
  }
}
