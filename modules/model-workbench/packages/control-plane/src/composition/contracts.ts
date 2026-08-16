import type { Sha256Digest } from '@ta-agent/workbench-domain';
import type { ResolvedWorkbenchSetup } from '@ta-agent/workbench-setup';

import type { InitializationOperations } from '../operations/initialization/contracts.js';
import type { WorkbenchIdSource } from '../ports/workbench-id-source.js';
import type { ModelAssetQueries, RunQueries } from '../queries/contracts.js';
import type { ControlPlanePersistence } from './persistence.js';

export interface WorkbenchControlPlaneConfiguration {
  readonly setup: ResolvedWorkbenchSetup;
  readonly persistence: ControlPlanePersistence;
  readonly idSource: WorkbenchIdSource;
}

export interface ModelWorkbenchControlPlane {
  readonly setup: {
    readonly evidenceDigest: Sha256Digest;
  };
  readonly initialization: InitializationOperations;
  readonly runs: RunQueries;
  readonly models: ModelAssetQueries;
}
