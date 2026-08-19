import type { BaseId, ModificationId, RunId } from '../../foundation/identifiers.js';
import type { JsonValue } from '../../foundation/json.js';
import { modelStatesEqual } from '../../model-assets/model-state.js';
import {
  ModelOperationKind,
  ModelRecordKind,
  ModelRunResultKind,
  ModelRunStatus,
} from '../constants.js';
import type { ExecutionFailure } from '../execution-failure.js';
import type { ExecutionReference } from '../execution-reference.js';
import type {
  ActiveInitializationRun,
  ActiveModelRun,
  ActiveTrainingRun,
  BaseRunResult,
  CancelledInitializationRun,
  CancelledModelRun,
  CancelledTrainingRun,
  FailedInitializationRun,
  FailedModelRun,
  FailedTrainingRun,
  InitializationRunSelection,
  LostInitializationRun,
  LostModelRun,
  LostTrainingRun,
  ModelRun,
  ModificationRunResult,
  RunningInitializationRun,
  RunningModelRun,
  RunningTrainingRun,
  StartingInitializationRun,
  StartingModelRun,
  StartingTrainingRun,
  SucceededInitializationRun,
  SucceededTrainingBaseRun,
  SucceededTrainingModificationRun,
  SucceededTrainingRun,
  TrainingRunSelection,
} from './contracts.js';

export function defineStartingInitializationRun(
  input: Readonly<{ readonly runId: RunId } & InitializationRunSelection>
): StartingInitializationRun {
  return Object.freeze({
    kind: ModelRecordKind.Run,
    operation: ModelOperationKind.Initialization,
    status: ModelRunStatus.Starting,
    ...input,
  });
}

export function defineStartingTrainingRun(
  input: Readonly<{ readonly runId: RunId } & TrainingRunSelection>
): StartingTrainingRun {
  return Object.freeze({
    kind: ModelRecordKind.Run,
    operation: ModelOperationKind.Training,
    status: ModelRunStatus.Starting,
    ...input,
  });
}

export function startModelRunExecution(
  run: StartingInitializationRun,
  execution: ExecutionReference
): RunningInitializationRun;
export function startModelRunExecution(
  run: StartingTrainingRun,
  execution: ExecutionReference
): RunningTrainingRun;
export function startModelRunExecution(
  run: StartingModelRun,
  execution: ExecutionReference
): RunningModelRun;
export function startModelRunExecution(
  run: StartingModelRun,
  execution: ExecutionReference
): RunningModelRun {
  return Object.freeze({ ...run, status: ModelRunStatus.Running, execution });
}

export function updateModelRunProgress(
  run: RunningInitializationRun,
  progress?: JsonValue
): RunningInitializationRun;
export function updateModelRunProgress(
  run: RunningTrainingRun,
  progress?: JsonValue
): RunningTrainingRun;
export function updateModelRunProgress(run: RunningModelRun, progress?: JsonValue): RunningModelRun;
export function updateModelRunProgress(
  run: RunningModelRun,
  progress?: JsonValue
): RunningModelRun {
  const { progress: previousProgress, ...withoutProgress } = run;
  void previousProgress;
  return Object.freeze({
    ...withoutProgress,
    ...(progress === undefined ? {} : { progress }),
  }) as RunningModelRun;
}

export function succeedInitializationRun(
  run: ActiveInitializationRun,
  baseId: BaseId,
  data?: JsonValue
): SucceededInitializationRun {
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

export function succeedTrainingRun(
  run: ActiveTrainingRun,
  result: Readonly<{ readonly kind: typeof ModelRunResultKind.Base; readonly baseId: BaseId }>,
  data?: JsonValue
): SucceededTrainingBaseRun;
export function succeedTrainingRun(
  run: ActiveTrainingRun,
  result: Readonly<{
    readonly kind: typeof ModelRunResultKind.Modification;
    readonly modificationId: ModificationId;
  }>,
  data?: JsonValue
): SucceededTrainingModificationRun;
export function succeedTrainingRun(
  run: ActiveTrainingRun,
  result: Readonly<
    | { readonly kind: typeof ModelRunResultKind.Base; readonly baseId: BaseId }
    | {
        readonly kind: typeof ModelRunResultKind.Modification;
        readonly modificationId: ModificationId;
      }
  >,
  data?: JsonValue
): SucceededTrainingRun {
  if (result.kind === ModelRunResultKind.Base) {
    const runResult: BaseRunResult = Object.freeze({
      ...result,
      ...(data === undefined ? {} : { data }),
    });
    return Object.freeze({ ...run, status: ModelRunStatus.Succeeded, result: runResult });
  }
  const runResult: ModificationRunResult = Object.freeze({
    ...result,
    ...(data === undefined ? {} : { data }),
  });
  return Object.freeze({ ...run, status: ModelRunStatus.Succeeded, result: runResult });
}

export function failModelRun(
  run: ActiveInitializationRun,
  failure: ExecutionFailure
): FailedInitializationRun;
export function failModelRun(run: ActiveTrainingRun, failure: ExecutionFailure): FailedTrainingRun;
export function failModelRun(run: ActiveModelRun, failure: ExecutionFailure): FailedModelRun;
export function failModelRun(run: ActiveModelRun, failure: ExecutionFailure): FailedModelRun {
  return Object.freeze({ ...run, status: ModelRunStatus.Failed, failure }) as FailedModelRun;
}

export function cancelModelRun(
  run: ActiveInitializationRun,
  reason?: JsonValue
): CancelledInitializationRun;
export function cancelModelRun(run: ActiveTrainingRun, reason?: JsonValue): CancelledTrainingRun;
export function cancelModelRun(run: ActiveModelRun, reason?: JsonValue): CancelledModelRun;
export function cancelModelRun(run: ActiveModelRun, reason?: JsonValue): CancelledModelRun {
  return Object.freeze({
    ...run,
    status: ModelRunStatus.Cancelled,
    ...(reason === undefined ? {} : { reason }),
  }) as CancelledModelRun;
}

export function loseModelRun(
  run: ActiveInitializationRun,
  failure: ExecutionFailure
): LostInitializationRun;
export function loseModelRun(run: ActiveTrainingRun, failure: ExecutionFailure): LostTrainingRun;
export function loseModelRun(run: ActiveModelRun, failure: ExecutionFailure): LostModelRun;
export function loseModelRun(run: ActiveModelRun, failure: ExecutionFailure): LostModelRun {
  return Object.freeze({ ...run, status: ModelRunStatus.Lost, failure }) as LostModelRun;
}

export function modelRunDefinitionsEqual(left: ModelRun, right: ModelRun): boolean {
  if (
    left.runId !== right.runId ||
    left.operation !== right.operation ||
    left.profileId !== right.profileId ||
    left.capabilityId !== right.capabilityId ||
    left.runtimeBindingId !== right.runtimeBindingId ||
    left.slotEvidenceDigest !== right.slotEvidenceDigest
  ) {
    return false;
  }
  if (
    left.operation === ModelOperationKind.Initialization &&
    right.operation === ModelOperationKind.Initialization
  ) {
    return left.initializerId === right.initializerId;
  }
  if (
    left.operation === ModelOperationKind.Training &&
    right.operation === ModelOperationKind.Training
  ) {
    return left.trainerId === right.trainerId && modelStatesEqual(left.source, right.source);
  }
  return false;
}

export function modelRunsEqual(left: ModelRun, right: ModelRun): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
