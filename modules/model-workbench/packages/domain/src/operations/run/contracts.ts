import type {
  BaseId,
  CapabilityId,
  ExporterId,
  InitializerId,
  ModificationId,
  OutputId,
  ProfileId,
  RunId,
  RuntimeBindingId,
  Sha256Digest,
  TrainerId,
} from '../../foundation/identifiers.js';
import type { JsonValue } from '../../foundation/json.js';
import type { ModelState } from '../../model-assets/model-state.js';
import {
  ModelOperationKind,
  ModelRecordKind,
  ModelRunResultKind,
  ModelRunStatus,
} from '../constants.js';
import type { ExecutionFailure } from '../execution-failure.js';
import type { ExecutionReference } from '../execution-reference.js';

interface ModelRunSelectionBase {
  readonly profileId: ProfileId;
  readonly capabilityId: CapabilityId;
  readonly runtimeBindingId: RuntimeBindingId;
  readonly slotEvidenceDigest: Sha256Digest;
}

export interface InitializationRunSelection extends ModelRunSelectionBase {
  readonly initializerId: InitializerId;
}

export interface TrainingRunSelection extends ModelRunSelectionBase {
  readonly trainerId: TrainerId;
  readonly source: ModelState;
}

export interface ExportRunSelection extends ModelRunSelectionBase {
  readonly exporterId: ExporterId;
  readonly source: ModelState;
}

interface ModelRunIdentity {
  readonly kind: typeof ModelRecordKind.Run;
  readonly runId: RunId;
}

interface InitializationRunDefinition extends ModelRunIdentity, InitializationRunSelection {
  readonly operation: typeof ModelOperationKind.Initialization;
}

interface TrainingRunDefinition extends ModelRunIdentity, TrainingRunSelection {
  readonly operation: typeof ModelOperationKind.Training;
}

interface ExportRunDefinition extends ModelRunIdentity, ExportRunSelection {
  readonly operation: typeof ModelOperationKind.Export;
}

interface StartingRunLifecycle {
  readonly status: typeof ModelRunStatus.Starting;
}

interface RunningRunLifecycle {
  readonly status: typeof ModelRunStatus.Running;
  readonly execution: ExecutionReference;
  readonly progress?: JsonValue;
}

interface ExecutedRunLifecycle {
  readonly execution?: ExecutionReference;
  readonly progress?: JsonValue;
}

interface FailedRunLifecycle extends ExecutedRunLifecycle {
  readonly status: typeof ModelRunStatus.Failed;
  readonly failure: ExecutionFailure;
}

interface CancelledRunLifecycle extends ExecutedRunLifecycle {
  readonly status: typeof ModelRunStatus.Cancelled;
  readonly reason?: JsonValue;
}

interface LostRunLifecycle extends ExecutedRunLifecycle {
  readonly status: typeof ModelRunStatus.Lost;
  readonly failure: ExecutionFailure;
}

export interface BaseRunResult {
  readonly kind: typeof ModelRunResultKind.Base;
  readonly baseId: BaseId;
  readonly data?: JsonValue;
}

export interface ModificationRunResult {
  readonly kind: typeof ModelRunResultKind.Modification;
  readonly modificationId: ModificationId;
  readonly data?: JsonValue;
}

export interface OutputRunResult {
  readonly kind: typeof ModelRunResultKind.Output;
  readonly outputId: OutputId;
  readonly data?: JsonValue;
}

export type TrainingRunResult = BaseRunResult | ModificationRunResult;

export type StartingInitializationRun = InitializationRunDefinition & StartingRunLifecycle;
export type RunningInitializationRun = InitializationRunDefinition & RunningRunLifecycle;
export type SucceededInitializationRun = InitializationRunDefinition &
  ExecutedRunLifecycle & {
    readonly status: typeof ModelRunStatus.Succeeded;
    readonly result: BaseRunResult;
  };
export type FailedInitializationRun = InitializationRunDefinition & FailedRunLifecycle;
export type CancelledInitializationRun = InitializationRunDefinition & CancelledRunLifecycle;
export type LostInitializationRun = InitializationRunDefinition & LostRunLifecycle;

export type StartingTrainingRun = TrainingRunDefinition & StartingRunLifecycle;
export type RunningTrainingRun = TrainingRunDefinition & RunningRunLifecycle;
export type SucceededTrainingBaseRun = TrainingRunDefinition &
  ExecutedRunLifecycle & {
    readonly status: typeof ModelRunStatus.Succeeded;
    readonly result: BaseRunResult;
  };
export type SucceededTrainingModificationRun = TrainingRunDefinition &
  ExecutedRunLifecycle & {
    readonly status: typeof ModelRunStatus.Succeeded;
    readonly result: ModificationRunResult;
  };
export type SucceededTrainingRun = SucceededTrainingBaseRun | SucceededTrainingModificationRun;
export type FailedTrainingRun = TrainingRunDefinition & FailedRunLifecycle;
export type CancelledTrainingRun = TrainingRunDefinition & CancelledRunLifecycle;
export type LostTrainingRun = TrainingRunDefinition & LostRunLifecycle;

export type StartingExportRun = ExportRunDefinition & StartingRunLifecycle;
export type RunningExportRun = ExportRunDefinition & RunningRunLifecycle;
export type SucceededExportRun = ExportRunDefinition &
  ExecutedRunLifecycle & {
    readonly status: typeof ModelRunStatus.Succeeded;
    readonly result: OutputRunResult;
  };
export type FailedExportRun = ExportRunDefinition & FailedRunLifecycle;
export type CancelledExportRun = ExportRunDefinition & CancelledRunLifecycle;
export type LostExportRun = ExportRunDefinition & LostRunLifecycle;

export type StartingModelRun = StartingInitializationRun | StartingTrainingRun | StartingExportRun;
export type RunningModelRun = RunningInitializationRun | RunningTrainingRun | RunningExportRun;
export type ActiveInitializationRun = StartingInitializationRun | RunningInitializationRun;
export type ActiveTrainingRun = StartingTrainingRun | RunningTrainingRun;
export type ActiveExportRun = StartingExportRun | RunningExportRun;
export type ActiveModelRun = ActiveInitializationRun | ActiveTrainingRun | ActiveExportRun;
export type SucceededModelRun =
  | SucceededInitializationRun
  | SucceededTrainingRun
  | SucceededExportRun;
export type FailedModelRun = FailedInitializationRun | FailedTrainingRun | FailedExportRun;
export type CancelledModelRun =
  | CancelledInitializationRun
  | CancelledTrainingRun
  | CancelledExportRun;
export type LostModelRun = LostInitializationRun | LostTrainingRun | LostExportRun;
export type TerminalInitializationRun =
  | SucceededInitializationRun
  | FailedInitializationRun
  | CancelledInitializationRun
  | LostInitializationRun;
export type TerminalTrainingRun =
  | SucceededTrainingRun
  | FailedTrainingRun
  | CancelledTrainingRun
  | LostTrainingRun;
export type TerminalExportRun =
  | SucceededExportRun
  | FailedExportRun
  | CancelledExportRun
  | LostExportRun;
export type TerminalModelRun = TerminalInitializationRun | TerminalTrainingRun | TerminalExportRun;
export type InitializationModelRun = ActiveInitializationRun | TerminalInitializationRun;
export type TrainingModelRun = ActiveTrainingRun | TerminalTrainingRun;
export type ExportModelRun = ActiveExportRun | TerminalExportRun;
export type ModelRun = InitializationModelRun | TrainingModelRun | ExportModelRun;
