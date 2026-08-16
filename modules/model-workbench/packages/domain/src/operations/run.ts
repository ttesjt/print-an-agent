import {
  ModelOperationKind,
  ModelRecordKind,
  ModelRunResultKind,
  ModelRunStatus,
} from './constants.js';
import type { ExecutionFailure } from './execution-failure.js';
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

export interface RunningModelRun extends ModelRunBase {
  readonly status: typeof ModelRunStatus.Running;
}

export interface SucceededModelRun extends ModelRunBase {
  readonly status: typeof ModelRunStatus.Succeeded;
  readonly result: {
    readonly kind: typeof ModelRunResultKind.Base;
    readonly baseId: BaseId;
    readonly data?: JsonValue;
  };
}

export interface FailedModelRun extends ModelRunBase {
  readonly status: typeof ModelRunStatus.Failed;
  readonly failure: ExecutionFailure;
}

export type TerminalModelRun = SucceededModelRun | FailedModelRun;
export type ModelRun = RunningModelRun | TerminalModelRun;

export function defineRunningInitializationRun(
  input: Readonly<{ readonly runId: RunId } & InitializationRunSelection>
): RunningModelRun {
  return Object.freeze({
    kind: ModelRecordKind.Run,
    operation: ModelOperationKind.Initialization,
    status: ModelRunStatus.Running,
    ...input,
  });
}

export function succeedInitializationRun(
  run: RunningModelRun,
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

export function failModelRun(run: RunningModelRun, failure: ExecutionFailure): FailedModelRun {
  return Object.freeze({ ...run, status: ModelRunStatus.Failed, failure });
}

export function modelRunsEqual(left: ModelRun, right: ModelRun): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
