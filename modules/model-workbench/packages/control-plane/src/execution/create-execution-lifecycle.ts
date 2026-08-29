import {
  InvalidWorkbenchValueError,
  ModelRunStatus,
  parseRunId,
  type ProfileId,
  updateModelRunProgress,
  type ActiveModelRun,
  type ModelRun,
  type TerminalModelRun,
} from '@ta-agent/workbench-domain';
import { ExecutionStatus } from '@ta-agent/workbench-extension';
import type { RunRepository } from '@ta-agent/workbench-persistence';

import type {
  ExecutionLifecycle,
  OperationExecutionHandler,
  OperationExecutionHandlers,
} from './contracts.js';
import { StartingRunResumeKind } from './contracts.js';
import { defineStartingRunResumeContext } from './dispatch-model-run.js';
import {
  ModelRunNotFoundError,
  ModelRunOperationUnavailableError,
  RunCancellationError,
  RunObservationError,
} from './errors.js';
import type { ModelWorkbenchOperationOptions } from './contracts.js';
import type { WaitForRunOptions } from '../queries/contracts.js';

export interface ExecutionLifecycleDependencies {
  readonly profileId: ProfileId;
  readonly runs: RunRepository;
  readonly handlers: OperationExecutionHandlers;
}

export function createExecutionLifecycle(
  dependencies: ExecutionLifecycleDependencies
): ExecutionLifecycle {
  assertHandlersMatchOperations(dependencies.handlers);
  const refresh = createRefreshRun(dependencies);
  return Object.freeze({
    runs: Object.freeze({
      get: async (runId: string) => {
        const requestedRunId = parseRunId(runId, 'runId');
        const run = await dependencies.runs.find(requestedRunId);
        return run?.profileId === dependencies.profileId && run.runId === requestedRunId
          ? run
          : undefined;
      },
      refresh,
      wait: (runId: string, options?: WaitForRunOptions) => waitForRun(refresh, runId, options),
      cancel: createCancelRun(dependencies),
    }),
  });
}

function createRefreshRun(dependencies: ExecutionLifecycleDependencies) {
  return async function refreshRun(
    inputRunId: string,
    options?: ModelWorkbenchOperationOptions
  ): Promise<ModelRun> {
    assertNotAborted(options?.signal, 'Run observation was aborted.');
    const run = await requireRun(dependencies.runs, dependencies.profileId, inputRunId);
    if (isTerminal(run)) return run;

    const handler = handlerFor(dependencies.handlers, run);
    if (run.status === ModelRunStatus.Starting) {
      return handler.resumeStarting(
        run,
        defineStartingRunResumeContext(StartingRunResumeKind.Recovery, options)
      );
    }
    const support = handler.resolveExecutionSupport(run);
    let observation;
    try {
      observation = await support.observe(
        Object.freeze({ profileId: run.profileId, executionReceipt: run.execution.receipt }),
        options
      );
    } catch (cause: unknown) {
      if (isAbortError(cause)) throw cause;
      if (cause instanceof InvalidWorkbenchValueError) {
        return handler.rejectInvalidObservation(run, cause);
      }
      throw new RunObservationError(run.runId, { cause });
    }

    if (observation.status === ExecutionStatus.Running) {
      const updated = updateModelRunProgress(run, observation.progress);
      await dependencies.runs.updateActive(updated);
      return updated;
    }
    return handler.completeObserved(run, observation, options);
  };
}

function createCancelRun(dependencies: ExecutionLifecycleDependencies) {
  return async function cancelRun(inputRunId: string, options?: ModelWorkbenchOperationOptions) {
    assertNotAborted(options?.signal, 'Run cancellation was aborted.');
    let run = await requireRun(dependencies.runs, dependencies.profileId, inputRunId);
    if (isTerminal(run)) return run.runId;
    const handler = handlerFor(dependencies.handlers, run);
    if (run.status === ModelRunStatus.Starting) {
      if (run.dispatchedAt === undefined) {
        await handler.cancelStarting(run, options);
        return run.runId;
      }
      run = await handler.resumeStarting(
        run,
        defineStartingRunResumeContext(StartingRunResumeKind.Recovery, options)
      );
      if (isTerminal(run)) return run.runId;
    }
    const support = handler.resolveExecutionSupport(run);
    try {
      await support.cancel(
        Object.freeze({ profileId: run.profileId, executionReceipt: run.execution.receipt }),
        options
      );
      return run.runId;
    } catch (cause: unknown) {
      if (isAbortError(cause)) throw cause;
      throw new RunCancellationError(run.runId, { cause });
    }
  };
}

async function waitForRun(
  refresh: ReturnType<typeof createRefreshRun>,
  runId: string,
  options?: WaitForRunOptions
): Promise<TerminalModelRun> {
  const interval = options?.pollIntervalMilliseconds ?? 250;
  if (!Number.isSafeInteger(interval) || interval < 0) {
    throw new RangeError('pollIntervalMilliseconds must be a non-negative safe integer.');
  }
  const refreshOptions =
    options?.signal === undefined ? undefined : Object.freeze({ signal: options.signal });
  while (true) {
    const run = await refresh(runId, refreshOptions);
    if (isTerminal(run)) return run;
    await wait(interval, options?.signal);
  }
}

function handlerFor(
  handlers: OperationExecutionHandlers,
  run: ActiveModelRun
): OperationExecutionHandler {
  const handler = handlers[run.operation];
  if (handler === undefined) {
    throw new ModelRunOperationUnavailableError(run.runId, run.operation);
  }
  return handler;
}

function assertHandlersMatchOperations(handlers: OperationExecutionHandlers): void {
  for (const [operation, handler] of Object.entries(handlers)) {
    if (handler !== undefined && handler.operation !== operation) {
      throw new TypeError(
        `Execution handler for operation "${operation}" declares "${handler.operation}".`
      );
    }
  }
}

async function requireRun(
  runs: RunRepository,
  profileId: ProfileId,
  inputRunId: string
): Promise<ModelRun> {
  const runId = parseRunId(inputRunId, 'runId');
  const run = await runs.find(runId);
  if (run === undefined || run.profileId !== profileId || run.runId !== runId) {
    throw new ModelRunNotFoundError(runId);
  }
  return run;
}

function isTerminal(run: ModelRun): run is TerminalModelRun {
  return (
    run.status === ModelRunStatus.Succeeded ||
    run.status === ModelRunStatus.Failed ||
    run.status === ModelRunStatus.Cancelled ||
    run.status === ModelRunStatus.Lost
  );
}

function wait(milliseconds: number, signal: AbortSignal | undefined): Promise<void> {
  if (milliseconds === 0) {
    assertNotAborted(signal, 'Waiting for Run completion was aborted.');
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, milliseconds);
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      reject(abortError('Waiting for Run completion was aborted.', signal?.reason));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function assertNotAborted(signal: AbortSignal | undefined, message: string): void {
  if (signal?.aborted === true) throw abortError(message, signal.reason);
}

function abortError(message: string, cause: unknown): Error {
  const error = new Error(message, { cause });
  error.name = 'AbortError';
  return error;
}

function isAbortError(cause: unknown): boolean {
  return cause instanceof Error && cause.name === 'AbortError';
}
