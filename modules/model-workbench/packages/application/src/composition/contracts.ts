import type { WorkbenchClock, WorkbenchIdSource } from '@print-an-agent/workbench-control-plane';
import type { ProfilePersistenceAdapter } from '@print-an-agent/workbench-persistence';
import type { WorkbenchExtensionResources } from '@print-an-agent/workbench-setup';

export interface ModelWorkbenchApplicationConfiguration {
  readonly setup: unknown;
  readonly extensions: WorkbenchExtensionResources;
  readonly persistence?: ProfilePersistenceAdapter;
  readonly idSource?: WorkbenchIdSource;
  readonly clock?: WorkbenchClock;
}
