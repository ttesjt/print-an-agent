import type { FailedModelRun, ModelBase, SucceededModelRun } from '@ta-agent/workbench-domain';

export interface SucceededInitializationCommit {
  readonly run: SucceededModelRun;
  readonly base: ModelBase;
}

export interface FailedInitializationCommit {
  readonly run: FailedModelRun;
}

export type InitializationCommit = SucceededInitializationCommit | FailedInitializationCommit;

export interface InitializationCommitter {
  commit(input: InitializationCommit): Promise<void>;
}
