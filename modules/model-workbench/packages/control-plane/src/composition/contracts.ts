import type { Sha256Digest } from '@print-an-agent/workbench-domain';
import type { ResolvedWorkbenchSetup } from '@print-an-agent/workbench-setup';
import type { ProfilePersistenceAdapter } from '@print-an-agent/workbench-persistence';

import type { InitializationOperations } from '../operations/initialization/contracts.js';
import type { ExportOperations } from '../operations/export/contracts.js';
import type { TrainingOperations } from '../operations/training/contracts.js';
import type { OutputInvocationOperations } from '../operations/output-invocation/contracts.js';
import type { WorkbenchIdSource } from '../ports/workbench-id-source.js';
import type { WorkbenchClock } from '../ports/workbench-clock.js';
import type { ModelAssetQueries, OutputQueries, RunControls } from '../queries/contracts.js';

export interface WorkbenchControlPlaneConfiguration {
  readonly setup: ResolvedWorkbenchSetup;
  readonly persistence: ProfilePersistenceAdapter;
  readonly idSource: WorkbenchIdSource;
  readonly clock: WorkbenchClock;
}

export interface ModelWorkbenchControlPlane {
  readonly setup: {
    readonly evidenceDigest: Sha256Digest;
  };
  readonly initialization: InitializationOperations;
  readonly training: TrainingOperations;
  readonly exports: ExportOperations;
  readonly outputInvocations: OutputInvocationOperations;
  readonly runs: RunControls;
  readonly models: ModelAssetQueries;
  readonly outputs: OutputQueries;
}
