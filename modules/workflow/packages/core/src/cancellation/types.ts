export type ExecutionSignalSources = readonly [AbortSignal, ...AbortSignal[]];

export type ExecutionTimeoutMilliseconds = number | null;

export interface ExecutionTimeoutFailure extends Error {
  readonly code: 'EXECUTION_TIMEOUT';
  readonly timeoutMilliseconds: number;
}

export interface RunWithExecutionTimeoutOptions {
  readonly parentSignal: AbortSignal;
  readonly timeoutMilliseconds: ExecutionTimeoutMilliseconds;
  /** Maps only the deadline owned by this invocation into its domain failure. */
  readonly createTimeoutFailure?: ExecutionTimeoutFailureFactory;
}

export interface ExecutionTimeoutFailureFactoryInput {
  readonly timeoutMilliseconds: number;
  readonly cause: unknown;
}

export type ExecutionTimeoutFailureFactory = (input: ExecutionTimeoutFailureFactoryInput) => Error;
