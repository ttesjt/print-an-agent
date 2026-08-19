import type {
  CancelledModelRun,
  FailedModelRun,
  LostModelRun,
  ModelBase,
  SucceededModelRun,
} from '@ta-agent/workbench-domain';

export interface SucceededInitializationCommit {
  readonly run: SucceededModelRun;
  readonly base: ModelBase;
}

export interface UnsuccessfulInitializationCommit {
  readonly run: FailedModelRun | CancelledModelRun | LostModelRun;
}

export type InitializationCommit = SucceededInitializationCommit | UnsuccessfulInitializationCommit;

export interface InitializationCommitter {
  commit(input: InitializationCommit): Promise<void>;
}
