import type { ModelBase, ModelRun, RunId, TerminalModelRun } from '@ta-agent/workbench-domain';
import type { ModelWorkbenchOperationOptions } from '../execution/contracts.js';

export interface WaitForRunOptions extends ModelWorkbenchOperationOptions {
  readonly pollIntervalMilliseconds?: number;
}

export interface RunControls {
  get(runId: string): Promise<ModelRun | undefined>;
  refresh(runId: string, options?: ModelWorkbenchOperationOptions): Promise<ModelRun>;
  wait(runId: string, options?: WaitForRunOptions): Promise<TerminalModelRun>;
  cancel(runId: string, options?: ModelWorkbenchOperationOptions): Promise<RunId>;
}

export interface ModelAssetQueries {
  getBase(baseId: string): Promise<ModelBase | undefined>;
}
