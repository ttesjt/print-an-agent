import type {
  CancelledTrainingRun,
  FailedTrainingRun,
  LostTrainingRun,
  ModelModification,
  SucceededTrainingBaseRun,
  SucceededTrainingModificationRun,
  TrainingModelBase,
} from '@print-an-agent/workbench-domain';

export interface SucceededTrainingBaseCommit {
  readonly run: SucceededTrainingBaseRun;
  readonly base: TrainingModelBase;
}

export interface SucceededTrainingModificationCommit {
  readonly run: SucceededTrainingModificationRun;
  readonly modification: ModelModification;
}

export interface UnsuccessfulTrainingCommit {
  readonly run: FailedTrainingRun | CancelledTrainingRun | LostTrainingRun;
}

export type TrainingCommit =
  | SucceededTrainingBaseCommit
  | SucceededTrainingModificationCommit
  | UnsuccessfulTrainingCommit;

export interface TrainingCommitter {
  commit(input: TrainingCommit): Promise<void>;
}
