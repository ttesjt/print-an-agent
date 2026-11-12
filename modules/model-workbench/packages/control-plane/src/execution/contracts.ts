import type {
  ActiveModelRun,
  JsonValue,
  ModelOperationKind,
  ModelRun,
  RunId,
  RunningModelRun,
  StartingModelRun,
  TerminalModelRun,
} from '@print-an-agent/workbench-domain';
import type {
  ExecutionSupportRuntime,
  ExecutionTerminal,
} from '@print-an-agent/workbench-extension';

import type { WaitForRunOptions } from '../queries/contracts.js';

export interface ModelWorkbenchOperationOptions {
  readonly signal?: AbortSignal;
}

export const StartingRunResumeKind = {
  InitialDispatch: 'initial-dispatch',
  Recovery: 'recovery',
} as const;

export type StartingRunResumeKind =
  (typeof StartingRunResumeKind)[keyof typeof StartingRunResumeKind];

export interface StartingRunResumeContext {
  readonly kind: StartingRunResumeKind;
  readonly options?: ModelWorkbenchOperationOptions;
}

/** Operation-specific slots consumed by the fixed execution lifecycle. */
export interface OperationExecutionHandler {
  readonly operation: ModelOperationKind;
  resumeStarting(
    run: StartingModelRun,
    context: StartingRunResumeContext
  ): Promise<RunningModelRun | TerminalModelRun>;
  cancelStarting(
    run: StartingModelRun,
    options?: ModelWorkbenchOperationOptions
  ): Promise<TerminalModelRun>;
  resolveExecutionSupport(run: ActiveModelRun): ExecutionSupportRuntime;
  completeObserved(
    run: RunningModelRun,
    terminal: ExecutionTerminal<JsonValue>,
    options?: ModelWorkbenchOperationOptions
  ): Promise<TerminalModelRun>;
  rejectInvalidObservation(run: RunningModelRun, cause: unknown): Promise<never>;
}

export type OperationExecutionHandlers = Readonly<
  Partial<Record<ModelOperationKind, OperationExecutionHandler>>
>;

export interface ExecutionLifecycle {
  readonly runs: ExecutionRunControls;
}

/** Internal controls bound to one already-resolved Profile persistence scope. */
export interface ExecutionRunControls {
  get(runId: string): Promise<ModelRun | undefined>;
  refresh(runId: string, options?: ModelWorkbenchOperationOptions): Promise<ModelRun>;
  wait(runId: string, options?: WaitForRunOptions): Promise<TerminalModelRun>;
  cancel(runId: string, options?: ModelWorkbenchOperationOptions): Promise<RunId>;
}
