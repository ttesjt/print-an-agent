import type { BaseId, ModificationId, OutputId, RunId } from '../../foundation/identifiers.js';
import { canonicalJson, parseJsonValue, type JsonValue } from '../../foundation/json.js';
import type { Timestamp } from '../../foundation/timestamp.js';
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
  ActiveExportRun,
  ActiveModelRun,
  ActiveTrainingRun,
  BaseRunResult,
  CancelledInitializationRun,
  CancelledExportRun,
  CancelledModelRun,
  CancelledTrainingRun,
  DispatchedStartingExportRun,
  DispatchedStartingInitializationRun,
  DispatchedStartingModelRun,
  DispatchedStartingTrainingRun,
  FailedInitializationRun,
  FailedExportRun,
  FailedModelRun,
  FailedTrainingRun,
  InitializationRunSelection,
  ExportRunSelection,
  LostInitializationRun,
  LostExportRun,
  LostModelRun,
  LostTrainingRun,
  ModelRun,
  ModificationRunResult,
  RunningInitializationRun,
  RunningExportRun,
  RunningModelRun,
  RunningTrainingRun,
  StartingInitializationRun,
  StartingExportRun,
  StartingModelRun,
  StartingTrainingRun,
  SucceededInitializationRun,
  SucceededExportRun,
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

export function defineStartingExportRun(
  input: Readonly<{ readonly runId: RunId } & ExportRunSelection>
): StartingExportRun {
  return Object.freeze({
    kind: ModelRecordKind.Run,
    operation: ModelOperationKind.Export,
    status: ModelRunStatus.Starting,
    ...input,
  });
}

export function startModelRunExecution(
  run: DispatchedStartingInitializationRun,
  execution: ExecutionReference
): RunningInitializationRun;
export function startModelRunExecution(
  run: DispatchedStartingTrainingRun,
  execution: ExecutionReference
): RunningTrainingRun;
export function startModelRunExecution(
  run: DispatchedStartingExportRun,
  execution: ExecutionReference
): RunningExportRun;
export function startModelRunExecution(
  run: DispatchedStartingModelRun,
  execution: ExecutionReference
): RunningModelRun;
export function startModelRunExecution(
  run: DispatchedStartingModelRun,
  execution: ExecutionReference
): RunningModelRun {
  return Object.freeze({ ...run, status: ModelRunStatus.Running, execution });
}

export function markModelRunDispatched(
  run: StartingInitializationRun,
  dispatchedAt: Timestamp
): DispatchedStartingInitializationRun;
export function markModelRunDispatched(
  run: StartingTrainingRun,
  dispatchedAt: Timestamp
): DispatchedStartingTrainingRun;
export function markModelRunDispatched(
  run: StartingExportRun,
  dispatchedAt: Timestamp
): DispatchedStartingExportRun;
export function markModelRunDispatched(
  run: StartingModelRun,
  dispatchedAt: Timestamp
): DispatchedStartingModelRun;
export function markModelRunDispatched(
  run: StartingModelRun,
  dispatchedAt: Timestamp
): DispatchedStartingModelRun {
  return Object.freeze({ ...run, dispatchedAt });
}

export function updateModelRunProgress(
  run: RunningInitializationRun,
  progress?: JsonValue
): RunningInitializationRun;
export function updateModelRunProgress(
  run: RunningTrainingRun,
  progress?: JsonValue
): RunningTrainingRun;
export function updateModelRunProgress(
  run: RunningExportRun,
  progress?: JsonValue
): RunningExportRun;
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
  terminalRecordedAt: Timestamp,
  data?: JsonValue
): SucceededInitializationRun {
  return Object.freeze({
    ...run,
    status: ModelRunStatus.Succeeded,
    terminalRecordedAt,
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
  terminalRecordedAt: Timestamp,
  data?: JsonValue
): SucceededTrainingBaseRun;
export function succeedTrainingRun(
  run: ActiveTrainingRun,
  result: Readonly<{
    readonly kind: typeof ModelRunResultKind.Modification;
    readonly modificationId: ModificationId;
  }>,
  terminalRecordedAt: Timestamp,
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
  terminalRecordedAt: Timestamp,
  data?: JsonValue
): SucceededTrainingRun {
  if (result.kind === ModelRunResultKind.Base) {
    const runResult: BaseRunResult = Object.freeze({
      ...result,
      ...(data === undefined ? {} : { data }),
    });
    return Object.freeze({
      ...run,
      status: ModelRunStatus.Succeeded,
      terminalRecordedAt,
      result: runResult,
    });
  }
  const runResult: ModificationRunResult = Object.freeze({
    ...result,
    ...(data === undefined ? {} : { data }),
  });
  return Object.freeze({
    ...run,
    status: ModelRunStatus.Succeeded,
    terminalRecordedAt,
    result: runResult,
  });
}

export function succeedExportRun(
  run: ActiveExportRun,
  outputId: OutputId,
  terminalRecordedAt: Timestamp,
  data?: JsonValue
): SucceededExportRun {
  return Object.freeze({
    ...run,
    status: ModelRunStatus.Succeeded,
    terminalRecordedAt,
    result: Object.freeze({
      kind: ModelRunResultKind.Output,
      outputId,
      ...(data === undefined ? {} : { data }),
    }),
  });
}

export function failModelRun(
  run: ActiveInitializationRun,
  failure: ExecutionFailure,
  terminalRecordedAt: Timestamp
): FailedInitializationRun;
export function failModelRun(
  run: ActiveTrainingRun,
  failure: ExecutionFailure,
  terminalRecordedAt: Timestamp
): FailedTrainingRun;
export function failModelRun(
  run: ActiveExportRun,
  failure: ExecutionFailure,
  terminalRecordedAt: Timestamp
): FailedExportRun;
export function failModelRun(
  run: ActiveModelRun,
  failure: ExecutionFailure,
  terminalRecordedAt: Timestamp
): FailedModelRun;
export function failModelRun(
  run: ActiveModelRun,
  failure: ExecutionFailure,
  terminalRecordedAt: Timestamp
): FailedModelRun {
  return Object.freeze({
    ...run,
    status: ModelRunStatus.Failed,
    terminalRecordedAt,
    failure,
  }) as FailedModelRun;
}

export function cancelModelRun(
  run: ActiveInitializationRun,
  terminalRecordedAt: Timestamp,
  reason?: JsonValue
): CancelledInitializationRun;
export function cancelModelRun(
  run: ActiveTrainingRun,
  terminalRecordedAt: Timestamp,
  reason?: JsonValue
): CancelledTrainingRun;
export function cancelModelRun(
  run: ActiveExportRun,
  terminalRecordedAt: Timestamp,
  reason?: JsonValue
): CancelledExportRun;
export function cancelModelRun(
  run: ActiveModelRun,
  terminalRecordedAt: Timestamp,
  reason?: JsonValue
): CancelledModelRun;
export function cancelModelRun(
  run: ActiveModelRun,
  terminalRecordedAt: Timestamp,
  reason?: JsonValue
): CancelledModelRun {
  return Object.freeze({
    ...run,
    status: ModelRunStatus.Cancelled,
    terminalRecordedAt,
    ...(reason === undefined ? {} : { reason }),
  }) as CancelledModelRun;
}

export function loseModelRun(
  run: ActiveInitializationRun,
  failure: ExecutionFailure,
  terminalRecordedAt: Timestamp
): LostInitializationRun;
export function loseModelRun(
  run: ActiveTrainingRun,
  failure: ExecutionFailure,
  terminalRecordedAt: Timestamp
): LostTrainingRun;
export function loseModelRun(
  run: ActiveExportRun,
  failure: ExecutionFailure,
  terminalRecordedAt: Timestamp
): LostExportRun;
export function loseModelRun(
  run: ActiveModelRun,
  failure: ExecutionFailure,
  terminalRecordedAt: Timestamp
): LostModelRun;
export function loseModelRun(
  run: ActiveModelRun,
  failure: ExecutionFailure,
  terminalRecordedAt: Timestamp
): LostModelRun {
  return Object.freeze({
    ...run,
    status: ModelRunStatus.Lost,
    terminalRecordedAt,
    failure,
  }) as LostModelRun;
}

export function modelRunDefinitionsEqual(left: ModelRun, right: ModelRun): boolean {
  if (
    left.runId !== right.runId ||
    left.operation !== right.operation ||
    left.profileId !== right.profileId ||
    left.capabilityId !== right.capabilityId ||
    left.runtimeBindingId !== right.runtimeBindingId ||
    left.slotEvidenceDigest !== right.slotEvidenceDigest ||
    left.createdAt !== right.createdAt ||
    canonicalJson(left.input) !== canonicalJson(right.input)
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
  if (
    left.operation === ModelOperationKind.Export &&
    right.operation === ModelOperationKind.Export
  ) {
    return left.exporterId === right.exporterId && modelStatesEqual(left.source, right.source);
  }
  return false;
}

export function modelRunsEqual(left: ModelRun, right: ModelRun): boolean {
  return canonicalJson(parseJsonValue(left)) === canonicalJson(parseJsonValue(right));
}
