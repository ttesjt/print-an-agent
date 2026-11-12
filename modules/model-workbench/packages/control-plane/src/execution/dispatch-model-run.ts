import {
  defineExecutionReference,
  markModelRunDispatched,
  startModelRunExecution,
  type DispatchedStartingExportRun,
  type DispatchedStartingInitializationRun,
  type DispatchedStartingModelRun,
  type DispatchedStartingTrainingRun,
  type RunningModelRun,
  type StartingExportRun,
  type StartingInitializationRun,
  type StartingModelRun,
  type StartingTrainingRun,
  type TerminalModelRun,
} from '@print-an-agent/workbench-domain';
import {
  CapabilityDispatchKind,
  type CapabilityDispatch,
  type ExecutionSupportRuntime,
  type ExecutionTerminal,
} from '@print-an-agent/workbench-extension';
import type { RunRepository } from '@print-an-agent/workbench-persistence';

import {
  StartingRunResumeKind,
  type ModelWorkbenchOperationOptions,
  type StartingRunResumeContext,
} from './contracts.js';
import { readWorkbenchClock, type WorkbenchClock } from '../ports/workbench-clock.js';

export function recordModelRunDispatch(
  runs: RunRepository,
  clock: WorkbenchClock,
  run: StartingInitializationRun
): Promise<DispatchedStartingInitializationRun>;
export function recordModelRunDispatch(
  runs: RunRepository,
  clock: WorkbenchClock,
  run: StartingTrainingRun
): Promise<DispatchedStartingTrainingRun>;
export function recordModelRunDispatch(
  runs: RunRepository,
  clock: WorkbenchClock,
  run: StartingExportRun
): Promise<DispatchedStartingExportRun>;
export function recordModelRunDispatch(
  runs: RunRepository,
  clock: WorkbenchClock,
  run: StartingModelRun
): Promise<DispatchedStartingModelRun>;
export async function recordModelRunDispatch(
  runs: RunRepository,
  clock: WorkbenchClock,
  run: StartingModelRun
): Promise<DispatchedStartingModelRun> {
  if (run.dispatchedAt !== undefined) {
    return markModelRunDispatched(run, run.dispatchedAt);
  }
  const dispatched = markModelRunDispatched(run, readWorkbenchClock(clock, 'clock.dispatchedAt'));
  await runs.updateActive(dispatched);
  return dispatched;
}

export interface AcceptCapabilityDispatchInput<TResult> {
  readonly run: DispatchedStartingModelRun;
  readonly dispatch: CapabilityDispatch<TResult>;
  readonly executionSupport: ExecutionSupportRuntime;
  readonly complete: (
    terminal: ExecutionTerminal<TResult>,
    options?: ModelWorkbenchOperationOptions
  ) => Promise<TerminalModelRun>;
}

export async function acceptCapabilityDispatch<TResult>(
  runs: RunRepository,
  input: AcceptCapabilityDispatchInput<TResult>,
  options?: ModelWorkbenchOperationOptions
): Promise<RunningModelRun | TerminalModelRun> {
  if (input.dispatch.kind === CapabilityDispatchKind.Completed) {
    return input.complete(input.dispatch.terminal, options);
  }
  const execution = defineExecutionReference({
    runtimeSupportId: input.executionSupport.runtimeSupportId,
    receipt: input.dispatch.executionReceipt,
  });
  const running = startModelRunExecution(input.run, execution);
  await runs.updateActive(running);
  return running;
}

export function defineStartingRunResumeContext(
  kind: StartingRunResumeContext['kind'],
  options?: ModelWorkbenchOperationOptions
): StartingRunResumeContext {
  return Object.freeze({ kind, ...(options === undefined ? {} : { options }) });
}

export function recoveryAbortPreservesStartingRun(
  context: StartingRunResumeContext,
  cause: unknown
): boolean {
  return context.kind === StartingRunResumeKind.Recovery && isAbortError(cause);
}

function isAbortError(cause: unknown): boolean {
  return cause instanceof Error && cause.name === 'AbortError';
}
