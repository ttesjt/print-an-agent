import { describe, expect, it, vi } from 'vitest';

import {
  defineExecutionReference,
  defineStartingInitializationRun,
  failModelRun,
  ModelOperationKind,
  parseCapabilityId,
  parseExecutionFailure,
  parseInitializerId,
  parseProfileId,
  parseRunId,
  parseRuntimeBindingId,
  parseRuntimeSupportId,
  parseSha256Digest,
  startModelRunExecution,
  type ActiveModelRun,
  type JsonValue,
  type RunningModelRun,
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

import type { OperationExecutionHandler } from '../../src/execution/contracts.js';
import { createExecutionLifecycle } from '../../src/execution/create-execution-lifecycle.js';
import { RunObservationError } from '../../src/execution/errors.js';

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
    const complete = vi.fn(() => Promise.resolve(failModelRun(starting, failure)));
    const lifecycle = createLifecycle(persistence.runs, handler);

    await expect(
      lifecycle.acceptCapabilityDispatch({
        run: starting,
        dispatch: {
          kind: CapabilityDispatchKind.Completed,
          terminal: { status: ExecutionStatus.Failed, failure },
        },
        complete,
      })
    ).resolves.toMatchObject({ status: 'failed' });

    expect(complete).toHaveBeenCalledOnce();
    expect(handler.resolveExecutionSupport).not.toHaveBeenCalled();
  });

  it('derives Execution Support from the operation handler before persisting a receipt', async () => {
    const persistence = createMemoryPersistence();
    const starting = startingRun();
    await persistence.runs.create(starting);
    const handler = operationHandler(executionSupport('execution.selected'));
    const lifecycle = createLifecycle(persistence.runs, handler);

    await lifecycle.acceptCapabilityDispatch({
      run: starting,
      dispatch: {
        kind: CapabilityDispatchKind.Accepted,
        executionReceipt: { backendJobId: 'job:1' },
      },
      complete: vi.fn(),
    });

    expect(handler.resolveExecutionSupport).toHaveBeenCalledWith(starting);
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
    await accept(lifecycle, starting);

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
    await accept(malformedLifecycle, malformedRun);

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
    await accept(unavailableLifecycle, unavailableRun);

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
});

interface HandlerOverrides {
  readonly completeObserved?: (
    run: RunningModelRun,
    terminal: ExecutionTerminal<JsonValue>
  ) => Promise<TerminalModelRun>;
  readonly rejectInvalidObservation?: (run: RunningModelRun, cause: unknown) => Promise<never>;
}

function operationHandler(support: ExecutionSupportRuntime, overrides: HandlerOverrides = {}) {
  const resolveExecutionSupport = vi.fn((_run: ActiveModelRun) => support);
  const completeObserved = vi.fn(
    overrides.completeObserved ??
      ((run: RunningModelRun, _terminal: ExecutionTerminal<JsonValue>) =>
        Promise.resolve(failModelRun(run, failure)))
  );
  const rejectInvalidObservation = vi.fn(
    overrides.rejectInvalidObservation ??
      ((_run: RunningModelRun, cause: unknown) =>
        Promise.reject(cause instanceof Error ? cause : new Error('Invalid observation.')))
  );
  return {
    operation: ModelOperationKind.Initialization,
    resolveExecutionSupport,
    completeObserved,
    rejectInvalidObservation,
  } satisfies OperationExecutionHandler;
}

function createLifecycle(runs: RunRepository, handler: OperationExecutionHandler) {
  return createExecutionLifecycle({
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

function startingRun() {
  return defineStartingInitializationRun({
    runId: parseRunId('run:fixture'),
    profileId: parseProfileId('profile:fixture'),
    initializerId: parseInitializerId('initializer:fixture'),
    capabilityId: parseCapabilityId('capability:fixture'),
    runtimeBindingId: parseRuntimeBindingId('runtime:fixture'),
    slotEvidenceDigest: parseSha256Digest(`sha256:${'a'.repeat(64)}`),
  });
}

function runningRun(
  starting: ReturnType<typeof startingRun>,
  runtimeSupportId: ReturnType<typeof parseRuntimeSupportId>
) {
  return startModelRunExecution(
    starting,
    defineExecutionReference({ runtimeSupportId, receipt: { backendJobId: 'job:1' } })
  );
}

function accept(
  lifecycle: ReturnType<typeof createLifecycle>,
  run: ReturnType<typeof startingRun>
) {
  return lifecycle.acceptCapabilityDispatch({
    run,
    dispatch: {
      kind: CapabilityDispatchKind.Accepted,
      executionReceipt: { backendJobId: 'job:1' },
    },
    complete: vi.fn(),
  });
}
