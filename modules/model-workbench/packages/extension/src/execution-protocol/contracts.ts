import type { ExecutionFailure, JsonValue } from '@ta-agent/workbench-domain';

import { CapabilityDispatchKind, ExecutionStatus } from './constants.js';

export interface SucceededExecution<TResult> {
  readonly status: typeof ExecutionStatus.Succeeded;
  readonly result: TResult;
}

export interface FailedExecution {
  readonly status: typeof ExecutionStatus.Failed;
  readonly failure: ExecutionFailure;
}

export interface CancelledExecution {
  readonly status: typeof ExecutionStatus.Cancelled;
  readonly reason?: JsonValue;
}

export interface LostExecution {
  readonly status: typeof ExecutionStatus.Lost;
  readonly failure: ExecutionFailure;
}

export type ExecutionTerminal<TResult> =
  | SucceededExecution<TResult>
  | FailedExecution
  | CancelledExecution
  | LostExecution;

export type CapabilityDispatch<TResult> =
  | {
      readonly kind: typeof CapabilityDispatchKind.Completed;
      readonly terminal: ExecutionTerminal<TResult>;
    }
  | {
      readonly kind: typeof CapabilityDispatchKind.Accepted;
      readonly executionReceipt: JsonValue;
    };

export type ExecutionObservation<TResult> =
  | {
      readonly status: typeof ExecutionStatus.Running;
      readonly progress?: JsonValue;
    }
  | ExecutionTerminal<TResult>;
