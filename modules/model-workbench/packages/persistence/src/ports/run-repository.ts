import type { ModelRun, RunId, RunningModelRun } from '@ta-agent/workbench-domain';

export interface RunRepository {
  create(run: RunningModelRun): Promise<void>;
  find(runId: RunId): Promise<ModelRun | undefined>;
}
