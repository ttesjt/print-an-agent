export type ResourceErrorCode =
  | 'RESOURCE_BLUEPRINT_INVALID'
  | 'RESOURCE_DEPENDENCY_CYCLE'
  | 'RESOURCE_NOT_DECLARED'
  | 'RESOURCE_BINDING_CONFLICT'
  | 'RESOURCE_EXTERNAL_BINDING_INVALID'
  | 'RESOURCE_SCOPE_MISMATCH'
  | 'RESOURCE_SCOPE_CLOSING'
  | 'RESOURCE_SCOPE_CLOSED'
  | 'RESOURCE_SCOPE_FENCED'
  | 'RESOURCE_OPERATION_ABORTED'
  | 'RESOURCE_INITIALIZATION_FAILED'
  | 'RESOURCE_CLEANUP_FAILED';

export class ResourceError extends Error {
  constructor(
    readonly code: ResourceErrorCode,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = 'ResourceError';
  }
}

/** Cleanup was attempted but quiescence could not be confirmed. Never an ordinary retry. */
export class ResourceCleanupError extends ResourceError {
  readonly primary: unknown;
  readonly failures: readonly unknown[];
  readonly blocked: readonly string[];

  constructor(options: {
    readonly primary?: unknown;
    readonly failures: readonly unknown[];
    readonly blocked?: readonly string[];
  }) {
    super('RESOURCE_CLEANUP_FAILED', 'Resource cleanup could not be confirmed.', {
      cause: options.primary,
    });
    this.name = 'ResourceCleanupError';
    this.primary = options.primary;
    this.failures = Object.freeze([...options.failures]);
    this.blocked = Object.freeze([...(options.blocked ?? [])]);
  }
}
