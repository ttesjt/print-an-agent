import type {
  BaseId,
  CapabilityId,
  InitializerId,
  ProfileId,
  RunId,
  RuntimeBindingId,
  Sha256Digest,
} from '../foundation/identifiers.js';
import type { JsonValue } from '../foundation/json.js';
import {
  ModelOperationKind,
  ModelRecordKind,
  ModelRunResultKind,
  ModelRunStatus,
} from './constants.js';
import type { ExecutionFailure } from './execution-failure.js';
import type { ExecutionReference } from './execution-reference.js';

export interface InitializationRunSelection {
  readonly profileId: ProfileId;
  readonly initializerId: InitializerId;
  readonly capabilityId: CapabilityId;
  readonly runtimeBindingId: RuntimeBindingId;
  readonly slotEvidenceDigest: Sha256Digest;
}

interface ModelRunBase extends InitializationRunSelection {
  readonly kind: typeof ModelRecordKind.Run;
  readonly operation: typeof ModelOperationKind.Initialization;
  readonly runId: RunId;
}

export interface StartingModelRun extends ModelRunBase {
  readonly status: typeof ModelRunStatus.Starting;
}

export interface RunningModelRun extends ModelRunBase {
  readonly status: typeof ModelRunStatus.Running;
  readonly execution: ExecutionReference;
  readonly progress?: JsonValue;
}

interface ExecutedModelRun extends ModelRunBase {
  readonly execution?: ExecutionReference;
  readonly progress?: JsonValue;
}

export interface SucceededModelRun extends ExecutedModelRun {
  readonly status: typeof ModelRunStatus.Succeeded;
  readonly result: {
    readonly kind: typeof ModelRunResultKind.Base;
    readonly baseId: BaseId;
    readonly data?: JsonValue;
  };
}

export interface FailedModelRun extends ExecutedModelRun {
  readonly status: typeof ModelRunStatus.Failed;
  readonly failure: ExecutionFailure;
}

export interface CancelledModelRun extends ExecutedModelRun {
  readonly status: typeof ModelRunStatus.Cancelled;
  readonly reason?: JsonValue;
}

export interface LostModelRun extends ExecutedModelRun {
  readonly status: typeof ModelRunStatus.Lost;
  readonly failure: ExecutionFailure;
}

export type ActiveModelRun = StartingModelRun | RunningModelRun;
export type TerminalModelRun =
  | SucceededModelRun
  | FailedModelRun
  | CancelledModelRun
  | LostModelRun;
export type ModelRun = ActiveModelRun | TerminalModelRun;

export function defineStartingInitializationRun(
  input: Readonly<{ readonly runId: RunId } & InitializationRunSelection>
): StartingModelRun {
  return Object.freeze({
    kind: ModelRecordKind.Run,
    operation: ModelOperationKind.Initialization,
    status: ModelRunStatus.Starting,
    ...input,
  });
}

export function startModelRunExecution(
  run: StartingModelRun,
  execution: ExecutionReference
): RunningModelRun {
  return Object.freeze({ ...run, status: ModelRunStatus.Running, execution });
}

export function updateModelRunProgress(
  run: RunningModelRun,
  progress?: JsonValue
): RunningModelRun {
  const { progress: previousProgress, ...withoutProgress } = run;
  void previousProgress;
  return Object.freeze({
    ...withoutProgress,
    ...(progress === undefined ? {} : { progress }),
  });
}

export function succeedInitializationRun(
  run: ActiveModelRun,
  baseId: BaseId,
  data?: JsonValue
): SucceededModelRun {
  return Object.freeze({
    ...run,
    status: ModelRunStatus.Succeeded,
    result: Object.freeze({
      kind: ModelRunResultKind.Base,
      baseId,
      ...(data === undefined ? {} : { data }),
    }),
  });
}

export function failModelRun(run: ActiveModelRun, failure: ExecutionFailure): FailedModelRun {
  return Object.freeze({ ...run, status: ModelRunStatus.Failed, failure });
}

export function cancelModelRun(run: ActiveModelRun, reason?: JsonValue): CancelledModelRun {
  return Object.freeze({
    ...run,
    status: ModelRunStatus.Cancelled,
    ...(reason === undefined ? {} : { reason }),
  });
}

export function loseModelRun(run: ActiveModelRun, failure: ExecutionFailure): LostModelRun {
  return Object.freeze({ ...run, status: ModelRunStatus.Lost, failure });
}

export function modelRunsEqual(left: ModelRun, right: ModelRun): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
