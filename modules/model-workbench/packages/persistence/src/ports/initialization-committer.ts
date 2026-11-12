import type {
  CancelledInitializationRun,
  FailedInitializationRun,
  LostInitializationRun,
  InitializationModelBase,
  SucceededInitializationRun,
} from '@print-an-agent/workbench-domain';

export interface SucceededInitializationCommit {
  readonly run: SucceededInitializationRun;
  readonly base: InitializationModelBase;
}

export interface UnsuccessfulInitializationCommit {
  readonly run: FailedInitializationRun | CancelledInitializationRun | LostInitializationRun;
}

export type InitializationCommit = SucceededInitializationCommit | UnsuccessfulInitializationCommit;

export interface InitializationCommitter {
  commit(input: InitializationCommit): Promise<void>;
}
