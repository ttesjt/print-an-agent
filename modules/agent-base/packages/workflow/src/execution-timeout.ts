import { composeExecutionSignal } from './lib/execution-cancellation.js';

export type ExecutionTimeoutMilliseconds = number | null;

export const NO_EXECUTION_TIMEOUT = null;
export const MAX_EXECUTION_TIMEOUT_MILLISECONDS = 2_147_483_647;

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

const executionTimeoutFailures = new WeakSet<object>();

class LocalExecutionTimeoutFailure extends Error implements ExecutionTimeoutFailure {
  readonly code = 'EXECUTION_TIMEOUT' as const;
  readonly timeoutMilliseconds: number;

  constructor(timeoutMilliseconds: number, cause?: unknown) {
    super(`Execution exceeded ${timeoutMilliseconds} milliseconds.`, {
      ...(cause === undefined ? {} : { cause }),
    });
    this.name = 'ExecutionTimeoutError';
    this.timeoutMilliseconds = timeoutMilliseconds;
  }
}

function createExecutionTimeoutFailure(
  timeoutMilliseconds: number,
  cause?: unknown
): ExecutionTimeoutFailure {
  const error = new LocalExecutionTimeoutFailure(timeoutMilliseconds, cause);
  executionTimeoutFailures.add(error);
  return error;
}

function validateExecutionTimeoutMilliseconds(
  value: ExecutionTimeoutMilliseconds
): asserts value is ExecutionTimeoutMilliseconds {
  if (
    value !== null &&
    (!Number.isSafeInteger(value) || value < 1 || value > MAX_EXECUTION_TIMEOUT_MILLISECONDS)
  ) {
    throw new RangeError(
      `Execution timeout must be null or an integer from 1 through ${MAX_EXECUTION_TIMEOUT_MILLISECONDS}.`
    );
  }
}

export function isExecutionTimeoutFailure(value: unknown): value is ExecutionTimeoutFailure {
  return typeof value === 'object' && value !== null && executionTimeoutFailures.has(value);
}

function createOwnedTimeoutFailure(
  options: RunWithExecutionTimeoutOptions,
  timeoutMilliseconds: number,
  cause: unknown
): Error {
  return (
    options.createTimeoutFailure?.({ timeoutMilliseconds, cause }) ??
    createExecutionTimeoutFailure(timeoutMilliseconds, cause)
  );
}

export async function runWithExecutionTimeout<TResult>(
  options: RunWithExecutionTimeoutOptions,
  operation: (signal: AbortSignal) => Promise<TResult>
): Promise<TResult> {
  const { timeoutMilliseconds } = options;
  validateExecutionTimeoutMilliseconds(timeoutMilliseconds);
  if (timeoutMilliseconds === null) {
    return operation(options.parentSignal);
  }

  const timeoutController = new AbortController();
  const signal = composeExecutionSignal([options.parentSignal, timeoutController.signal]);
  let localTimeoutReason: DOMException | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const clearTimer = (): void => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  };

  if (!signal.aborted) {
    signal.addEventListener('abort', clearTimer, { once: true });
    timer = setTimeout(() => {
      timer = undefined;
      localTimeoutReason = new DOMException(
        `Execution exceeded ${timeoutMilliseconds} milliseconds.`,
        'TimeoutError'
      );
      timeoutController.abort(localTimeoutReason);
    }, timeoutMilliseconds);
  }

  let result: TResult;
  try {
    result = await operation(signal);
  } catch (error: unknown) {
    if (localTimeoutReason === undefined || isExecutionTimeoutFailure(error)) throw error;
    throw createOwnedTimeoutFailure(options, timeoutMilliseconds, error);
  } finally {
    clearTimer();
    signal.removeEventListener('abort', clearTimer);
  }
  if (localTimeoutReason !== undefined) {
    throw createOwnedTimeoutFailure(options, timeoutMilliseconds, localTimeoutReason);
  }
  return result;
}
