import type { ActiveModelRun, ModelRun, RunId, StartingModelRun } from '@ta-agent/workbench-domain';

export interface RunRepository {
  create(run: StartingModelRun): Promise<void>;
  updateActive(run: ActiveModelRun): Promise<void>;
  find(runId: RunId): Promise<ModelRun | undefined>;
}
