import type { WorkbenchIdSource } from '@ta-agent/workbench-control-plane';
import type { ProfilePersistenceAdapter } from '@ta-agent/workbench-persistence';
import type { WorkbenchExtensionResources } from '@ta-agent/workbench-setup';

export interface ModelWorkbenchApplicationConfiguration {
  readonly setup: unknown;
  readonly extensions: WorkbenchExtensionResources;
  readonly persistence?: ProfilePersistenceAdapter;
  readonly idSource?: WorkbenchIdSource;
}
