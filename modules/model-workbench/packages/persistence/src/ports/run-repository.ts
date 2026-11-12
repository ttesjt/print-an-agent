import type {
  ActiveModelRun,
  ModelRun,
  RunId,
  StartingModelRun,
} from '@print-an-agent/workbench-domain';
import type { PersistencePage, PersistencePageRequest } from './persistence-page.js';

export interface RunRepository {
  create(run: StartingModelRun): Promise<void>;
  updateActive(run: ActiveModelRun): Promise<void>;
  find(runId: RunId): Promise<ModelRun | undefined>;
  list(request: PersistencePageRequest<RunId>): Promise<PersistencePage<ModelRun>>;
}
