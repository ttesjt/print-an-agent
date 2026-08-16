import type { ModelBase, ModelRun } from '@ta-agent/workbench-domain';

export interface RunQueries {
  get(runId: string): Promise<ModelRun | undefined>;
}

export interface ModelAssetQueries {
  getBase(baseId: string): Promise<ModelBase | undefined>;
}
