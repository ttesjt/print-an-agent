import { describe, expect, it, vi } from 'vitest';

import {
  cancelModelRun,
  defineExecutionReference,
  defineModelState,
  defineStartingInitializationRun,
  defineStartingTrainingRun,
  failModelRun,
  markModelRunDispatched,
  ModelOperationKind,
  parseCapabilityId,
  parseExecutionFailure,
  parseInitializerId,
  parseProfileId,
  parseRunId,
  parseRuntimeBindingId,
  parseRuntimeSupportId,
  parseSha256Digest,
  parseTrainerId,
  parseTimestamp,
  startModelRunExecution,
  type ActiveModelRun,
  type JsonValue,
  type RunningModelRun,
  type StartingModelRun,
  type TerminalModelRun,
} from '@ta-agent/workbench-domain';
import {
  CapabilityDispatchKind,
  defineExecutionSupport,
  ExecutionStatus,
  type ExecutionSupportRuntime,
  type ExecutionTerminal,
} from '@ta-agent/workbench-extension';
import { createMemoryPersistence, type RunRepository } from '@ta-agent/workbench-persistence';

import {
  StartingRunResumeKind,
  type OperationExecutionHandler,
} from '../../src/execution/contracts.js';
import { createExecutionLifecycle } from '../../src/execution/create-execution-lifecycle.js';
import { acceptCapabilityDispatch } from '../../src/execution/dispatch-model-run.js';
import {
  ModelRunNotFoundError,
  ModelRunOperationUnavailableError,
  RunObservationError,
} from '../../src/execution/errors.js';

const failure = parseExecutionFailure({
  code: 'FIXTURE_TERMINAL',
  message: 'Fixture execution reached a terminal state.',
  retryable: false,
});

describe('Execution Lifecycle Engine', () => {
  it('routes completed dispatch directly to operation completion', async () => {
    const persistence = createMemoryPersistence();
    const starting = startingRun();
    await persistence.runs.create(starting);
    const support = executionSupport();
    const handler = operationHandler(support);
    const dispatched = markModelRunDispatched(starting, DISPATCHED_AT);
    const complete = vi.fn(() =>
      Promise.resolve(failModelRun(dispatched, failure, TERMINAL_RECORDED_AT))
    );

    await expect(
      acceptCapabilityDispatch(
        persistence.runs,
        {
          run: dispatched,
          dispatch: {
            kind: CapabilityDispatchKind.Completed,
            terminal: { status: ExecutionStatus.Failed, failure },
          },
          executionSupport: support,
          complete,
        },
        undefined
      )
    ).resolves.toMatchObject({ status: 'failed' });

    expect(complete).toHaveBeenCalledOnce();
    expect(handler.resolveExecutionSupport).not.toHaveBeenCalled();
  });

  it('derives Execution Support from the operation handler before persisting a receipt', async () => {
    const persistence = createMemoryPersistence();
    const starting = startingRun();
    await persistence.runs.create(starting);
    const handler = operationHandler(executionSupport('execution.selected'));
    const dispatched = markModelRunDispatched(starting, DISPATCHED_AT);

    await acceptCapabilityDispatch(persistence.runs, {
      run: dispatched,
      dispatch: {
        kind: CapabilityDispatchKind.Accepted,
        executionReceipt: { backendJobId: 'job:1' },
      },
      executionSupport: handler.resolveExecutionSupport(dispatched),
      complete: vi.fn(),
    });

    expect(handler.resolveExecutionSupport).toHaveBeenCalledWith(dispatched);
    await expect(persistence.runs.find(starting.runId)).resolves.toMatchObject({
      status: 'running',
      execution: {
        runtimeSupportId: 'execution.selected',
        receipt: { backendJobId: 'job:1' },
      },
    });
  });

  it('persists progress and routes terminal observation through the selected handler', async () => {
    const persistence = createMemoryPersistence();
    const starting = startingRun();
    await persistence.runs.create(starting);
    const observe = vi
      .fn<() => Promise<unknown>>()
      .mockResolvedValueOnce({ status: ExecutionStatus.Running, progress: { step: 4 } })
      .mockResolvedValueOnce({ status: ExecutionStatus.Failed, failure });
    const handler = operationHandler(executionSupport('execution.fixture', observe));
    const lifecycle = createLifecycle(persistence.runs, handler);
    await accept(persistence.runs, starting, handler.resolveExecutionSupport(starting));

    await expect(lifecycle.runs.refresh(starting.runId)).resolves.toMatchObject({
      status: 'running',
      progress: { step: 4 },
    });
    await expect(lifecycle.runs.refresh(starting.runId)).resolves.toMatchObject({
      status: 'failed',
    });

    expect(handler.completeObserved).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'running' }),
      { status: ExecutionStatus.Failed, failure },
      undefined
    );
  });

  it('delegates malformed observations but wraps backend observation failures', async () => {
    const malformedPersistence = createMemoryPersistence();
    const malformedRun = startingRun();
    await malformedPersistence.runs.create(malformedRun);
    const rejection = new Error('operation rejected malformed observation');
    const rejectInvalidObservation = vi.fn(() => Promise.reject(rejection));
    const malformedHandler = operationHandler(
      executionSupport('execution.malformed', () => Promise.resolve({ status: 'unknown' })),
      { rejectInvalidObservation }
    );
    const malformedLifecycle = createLifecycle(malformedPersistence.runs, malformedHandler);
    await accept(
      malformedPersistence.runs,
      malformedRun,
      malformedHandler.resolveExecutionSupport(malformedRun)
    );

    await expect(malformedLifecycle.runs.refresh(malformedRun.runId)).rejects.toBe(rejection);
    expect(rejectInvalidObservation).toHaveBeenCalledOnce();

    const unavailablePersistence = createMemoryPersistence();
    const unavailableRun = startingRun();
    await unavailablePersistence.runs.create(unavailableRun);
    const backendFailure = new Error('backend is unavailable');
    const unavailableLifecycle = createLifecycle(
      unavailablePersistence.runs,
      operationHandler(
        executionSupport('execution.unavailable', () => Promise.reject(backendFailure))
      )
    );
    await accept(
      unavailablePersistence.runs,
      unavailableRun,
      operationHandler(
        executionSupport('execution.unavailable', () => Promise.reject(backendFailure))
      ).resolveExecutionSupport(unavailableRun)
    );

    await expect(unavailableLifecycle.runs.refresh(unavailableRun.runId)).rejects.toMatchObject({
      name: RunObservationError.name,
      cause: backendFailure,
    });
  });

  it('preserves persistence and completion errors outside the observation boundary', async () => {
    const persistence = createMemoryPersistence();
    const starting = startingRun();
    const support = executionSupport('execution.fixture', () =>
      Promise.resolve({ status: ExecutionStatus.Running, progress: { step: 1 } })
    );
    const running = runningRun(starting, support.runtimeSupportId);
    await persistence.runs.create(starting);
    await persistence.runs.updateActive(running);

    const persistenceFailure = new Error('progress persistence failed');
    const rejectingRuns: RunRepository = Object.freeze({
      ...persistence.runs,
      updateActive: () => Promise.reject(persistenceFailure),
    });
    const lifecycle = createLifecycle(rejectingRuns, operationHandler(support));
    await expect(lifecycle.runs.refresh(starting.runId)).rejects.toBe(persistenceFailure);

    const completionFailure = new Error('terminal commitment failed');
    const terminalSupport = executionSupport('execution.fixture', () =>
      Promise.resolve({ status: ExecutionStatus.Failed, failure })
    );
    const terminalLifecycle = createLifecycle(
      persistence.runs,
      operationHandler(terminalSupport, {
        completeObserved: () => Promise.reject(completionFailure),
      })
    );
    await expect(terminalLifecycle.runs.refresh(starting.runId)).rejects.toBe(completionFailure);
  });

  it('rejects a handler registered under a different operation key', () => {
    const persistence = createMemoryPersistence();
    const mismatched = {
      ...operationHandler(executionSupport()),
      operation: 'training',
    } as unknown as OperationExecutionHandler;

    expect(() => createLifecycle(persistence.runs, mismatched)).toThrow('declares "training"');
  });

  it('routes a persisted starting Run back through its operation handler', async () => {
    const persistence = createMemoryPersistence();
    const starting = startingRun();
    await persistence.runs.create(starting);
    const support = executionSupport();
    const running = runningRun(starting, support.runtimeSupportId);
    const resumeStarting = vi.fn(() => Promise.resolve(running));
    const handler = operationHandler(support, { resumeStarting });
    const lifecycle = createLifecycle(persistence.runs, handler);

    await expect(lifecycle.runs.refresh(starting.runId)).resolves.toBe(running);
    expect(resumeStarting).toHaveBeenCalledWith(starting, {
      kind: StartingRunResumeKind.Recovery,
    });
  });

  it('recovers a dispatched starting Run before requesting backend cancellation', async () => {
    const persistence = createMemoryPersistence();
    const starting = markModelRunDispatched(startingRun(), DISPATCHED_AT);
    await persistence.runs.create(starting);
    const cancel = vi.fn(() => Promise.resolve());
    const support = defineExecutionSupport({
      runtimeSupportId: 'execution.fixture',
      observe: () => Promise.resolve({ status: ExecutionStatus.Running }),
      cancel,
    });
    const running = startModelRunExecution(
      starting,
      defineExecutionReference({
        runtimeSupportId: support.runtimeSupportId,
        receipt: { backendJobId: 'job:recovered' },
      })
    );
    const resumeStarting = vi.fn(() => Promise.resolve(running));
    const lifecycle = createLifecycle(
      persistence.runs,
      operationHandler(support, { resumeStarting })
    );

    await expect(lifecycle.runs.cancel(starting.runId)).resolves.toBe(starting.runId);
    expect(resumeStarting).toHaveBeenCalledWith(starting, {
      kind: StartingRunResumeKind.Recovery,
    });
    expect(cancel).toHaveBeenCalledWith(
      {
        profileId: starting.profileId,
        executionReceipt: { backendJobId: 'job:recovered' },
      },
      undefined
    );
  });

  it('terminalizes an undispatched starting Run without starting a backend task', async () => {
    const persistence = createMemoryPersistence();
    const starting = startingRun();
    await persistence.runs.create(starting);
    const cancelled = cancelModelRun(starting, TERMINAL_RECORDED_AT);
    const cancelStarting = vi.fn(async () => {
      await persistence.commits.initialization.commit({ run: cancelled });
      return cancelled;
    });
    const resumeStarting = vi.fn<OperationExecutionHandler['resumeStarting']>();
    const lifecycle = createLifecycle(
      persistence.runs,
      operationHandler(executionSupport(), { cancelStarting, resumeStarting })
    );

    await expect(lifecycle.runs.cancel(starting.runId)).resolves.toBe(starting.runId);
    expect(cancelStarting).toHaveBeenCalledWith(starting, undefined);
    expect(resumeStarting).not.toHaveBeenCalled();
    await expect(persistence.runs.find(starting.runId)).resolves.toEqual(cancelled);
  });

  it('reports an operation whose execution handler is not installed', async () => {
    const persistence = createMemoryPersistence();
    const starting = startingTrainingRun();
    const running = startModelRunExecution(
      markModelRunDispatched(starting, DISPATCHED_AT),
      defineExecutionReference({
        runtimeSupportId: parseRuntimeSupportId('execution.training'),
        receipt: { jobId: 'job:training' },
      })
    );
    await persistence.runs.create(starting);
    await persistence.runs.updateActive(running);
    const lifecycle = createLifecycle(persistence.runs, operationHandler(executionSupport()));

    await expect(lifecycle.runs.refresh(starting.runId)).rejects.toBeInstanceOf(
      ModelRunOperationUnavailableError
    );
  });

  it('rejects a same-Profile Run returned for a different requested identity', async () => {
    const persistence = createMemoryPersistence();
    const wrongStarting = startingRun('run:wrong');
    const observe = vi.fn(() =>
      Promise.resolve({ status: ExecutionStatus.Running, progress: { step: 1 } })
    );
    const cancel = vi.fn(() => Promise.resolve());
    const support = defineExecutionSupport({
      runtimeSupportId: 'execution.fixture',
      observe,
      cancel,
    });
    const wrongRunning = runningRun(wrongStarting, support.runtimeSupportId);
    const misroutingRuns: RunRepository = Object.freeze({
      ...persistence.runs,
      find: () => Promise.resolve(wrongRunning),
    });
    const lifecycle = createLifecycle(misroutingRuns, operationHandler(support));

    await expect(lifecycle.runs.get('run:requested')).resolves.toBeUndefined();
    await expect(lifecycle.runs.refresh('run:requested')).rejects.toBeInstanceOf(
      ModelRunNotFoundError
    );
    await expect(lifecycle.runs.cancel('run:requested')).rejects.toBeInstanceOf(
      ModelRunNotFoundError
    );
    expect(observe).not.toHaveBeenCalled();
    expect(cancel).not.toHaveBeenCalled();
  });
});

interface HandlerOverrides {
  readonly resumeStarting?: OperationExecutionHandler['resumeStarting'];
  readonly cancelStarting?: OperationExecutionHandler['cancelStarting'];
  readonly completeObserved?: (
    run: RunningModelRun,
    terminal: ExecutionTerminal<JsonValue>
  ) => Promise<TerminalModelRun>;
  readonly rejectInvalidObservation?: (run: RunningModelRun, cause: unknown) => Promise<never>;
}

function operationHandler(support: ExecutionSupportRuntime, overrides: HandlerOverrides = {}) {
  const resumeStarting = vi.fn(
    overrides.resumeStarting ??
      ((run: StartingModelRun) =>
        Promise.resolve(
          startModelRunExecution(
            markModelRunDispatched(run, DISPATCHED_AT),
            defineExecutionReference({
              runtimeSupportId: support.runtimeSupportId,
              receipt: { backendJobId: 'job:1' },
            })
          )
        ))
  );
  const cancelStarting = vi.fn(
    overrides.cancelStarting ??
      ((run: StartingModelRun) => Promise.resolve(cancelModelRun(run, TERMINAL_RECORDED_AT)))
  );
  const resolveExecutionSupport = vi.fn((_run: ActiveModelRun) => support);
  const completeObserved = vi.fn(
    overrides.completeObserved ??
      ((run: RunningModelRun, _terminal: ExecutionTerminal<JsonValue>) =>
        Promise.resolve(failModelRun(run, failure, TERMINAL_RECORDED_AT)))
  );
  const rejectInvalidObservation = vi.fn(
    overrides.rejectInvalidObservation ??
      ((_run: RunningModelRun, cause: unknown) =>
        Promise.reject(cause instanceof Error ? cause : new Error('Invalid observation.')))
  );
  return {
    operation: ModelOperationKind.Initialization,
    resumeStarting,
    cancelStarting,
    resolveExecutionSupport,
    completeObserved,
    rejectInvalidObservation,
  } satisfies OperationExecutionHandler;
}

function createLifecycle(runs: RunRepository, handler: OperationExecutionHandler) {
  return createExecutionLifecycle({
    profileId: parseProfileId('profile:fixture'),
    runs,
    handlers: { [ModelOperationKind.Initialization]: handler },
  });
}

function executionSupport(
  runtimeSupportId = 'execution.fixture',
  observe: () => Promise<unknown> = () => Promise.resolve({ status: ExecutionStatus.Running })
) {
  return defineExecutionSupport({
    runtimeSupportId,
    observe,
    cancel: () => Promise.resolve(),
  });
}

function startingRun(runId = 'run:fixture') {
  return defineStartingInitializationRun({
    runId: parseRunId(runId),
    profileId: parseProfileId('profile:fixture'),
    initializerId: parseInitializerId('initializer:fixture'),
    capabilityId: parseCapabilityId('capability:fixture'),
    runtimeBindingId: parseRuntimeBindingId('runtime:fixture'),
    slotEvidenceDigest: parseSha256Digest(`sha256:${'a'.repeat(64)}`),
    input: { fixture: true },
    createdAt: CREATED_AT,
  });
}

function startingTrainingRun() {
  return defineStartingTrainingRun({
    runId: parseRunId('run:training'),
    profileId: parseProfileId('profile:fixture'),
    trainerId: parseTrainerId('trainer:fixture'),
    capabilityId: parseCapabilityId('capability:trainer'),
    runtimeBindingId: parseRuntimeBindingId('runtime:training'),
    slotEvidenceDigest: parseSha256Digest(`sha256:${'b'.repeat(64)}`),
    source: defineModelState({ baseId: 'base:source', modificationIds: ['mod:source'] }),
    input: { fixture: true },
    createdAt: CREATED_AT,
  });
}

function runningRun(
  starting: ReturnType<typeof startingRun>,
  runtimeSupportId: ReturnType<typeof parseRuntimeSupportId>
) {
  return startModelRunExecution(
    markModelRunDispatched(starting, DISPATCHED_AT),
    defineExecutionReference({ runtimeSupportId, receipt: { backendJobId: 'job:1' } })
  );
}

function accept(
  runs: RunRepository,
  run: ReturnType<typeof startingRun>,
  support: ExecutionSupportRuntime
) {
  return acceptCapabilityDispatch(runs, {
    run: markModelRunDispatched(run, DISPATCHED_AT),
    dispatch: {
      kind: CapabilityDispatchKind.Accepted,
      executionReceipt: { backendJobId: 'job:1' },
    },
    executionSupport: support,
    complete: vi.fn(),
  });
}

const CREATED_AT = parseTimestamp('2026-08-24T10:00:00.000Z');
const DISPATCHED_AT = parseTimestamp('2026-08-24T10:00:01.000Z');
const TERMINAL_RECORDED_AT = parseTimestamp('2026-08-24T10:05:00.000Z');
