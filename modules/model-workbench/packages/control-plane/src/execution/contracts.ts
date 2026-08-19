import type {
  ActiveModelRun,
  JsonValue,
  ModelOperationKind,
  ModelRun,
  RunningModelRun,
  StartingModelRun,
  TerminalModelRun,
} from '@ta-agent/workbench-domain';
import type {
  CapabilityDispatch,
  ExecutionSupportRuntime,
  ExecutionTerminal,
} from '@ta-agent/workbench-extension';

import type { RunControls } from '../queries/contracts.js';

export interface ModelWorkbenchOperationOptions {
  readonly signal?: AbortSignal;
}

/** Operation-specific slots consumed by the fixed execution lifecycle. */
export interface OperationExecutionHandler {
  readonly operation: ModelOperationKind;
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

export interface AcceptCapabilityDispatchInput<TResult> {
  readonly run: StartingModelRun;
  readonly dispatch: CapabilityDispatch<TResult>;
  readonly complete: (
    terminal: ExecutionTerminal<TResult>,
    options?: ModelWorkbenchOperationOptions
  ) => Promise<TerminalModelRun>;
}

export interface ExecutionLifecycle {
  readonly runs: RunControls;
  acceptCapabilityDispatch<TResult>(
    input: AcceptCapabilityDispatchInput<TResult>,
    options?: ModelWorkbenchOperationOptions
  ): Promise<ModelRun>;
}
