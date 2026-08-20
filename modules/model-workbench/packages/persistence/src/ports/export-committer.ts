import type {
  CancelledExportRun,
  FailedExportRun,
  LostExportRun,
  ModelOutput,
  SucceededExportRun,
} from '@ta-agent/workbench-domain';

export interface SucceededExportCommit {
  readonly run: SucceededExportRun;
  readonly output: ModelOutput;
}

export interface UnsuccessfulExportCommit {
  readonly run: FailedExportRun | CancelledExportRun | LostExportRun;
}

export type ExportCommit = SucceededExportCommit | UnsuccessfulExportCommit;

export interface ExportCommitter {
  commit(input: ExportCommit): Promise<void>;
}
