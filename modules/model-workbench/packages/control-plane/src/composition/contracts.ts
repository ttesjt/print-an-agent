import type { Sha256Digest } from '@ta-agent/workbench-domain';
import type { ResolvedWorkbenchSetup } from '@ta-agent/workbench-setup';

import type { InitializationOperations } from '../operations/initialization/contracts.js';
import type { TrainingOperations } from '../operations/training/contracts.js';
import type { WorkbenchIdSource } from '../ports/workbench-id-source.js';
import type { ModelAssetQueries, RunControls } from '../queries/contracts.js';
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
  readonly training: TrainingOperations;
  readonly runs: RunControls;
  readonly models: ModelAssetQueries;
}
