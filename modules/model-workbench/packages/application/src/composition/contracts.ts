import type { ControlPlanePersistence, WorkbenchIdSource } from '@ta-agent/workbench-control-plane';
import type { WorkbenchExtensionResources } from '@ta-agent/workbench-setup';

export interface ModelWorkbenchApplicationConfiguration {
  readonly setup: unknown;
  readonly extensions: WorkbenchExtensionResources;
  readonly persistence?: ControlPlanePersistence;
  readonly idSource?: WorkbenchIdSource;
}
