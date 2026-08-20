import type {
  CapabilityId,
  ExporterId,
  InitializerId,
  RunId,
  RuntimeBindingId,
  Sha256Digest,
  TrainerId,
} from '../foundation/identifiers.js';
import { ModelOperationKind } from '../operations/constants.js';
import type { ModelState } from './model-state.js';

interface ModelOperationLineageBase {
  readonly runId: RunId;
  readonly capabilityId: CapabilityId;
  readonly runtimeBindingId: RuntimeBindingId;
  readonly slotEvidenceDigest: Sha256Digest;
}

export interface InitializationLineage extends ModelOperationLineageBase {
  readonly kind: typeof ModelOperationKind.Initialization;
  readonly initializerId: InitializerId;
}

export interface TrainingLineage extends ModelOperationLineageBase {
  readonly kind: typeof ModelOperationKind.Training;
  readonly trainerId: TrainerId;
  readonly source: ModelState;
}

export interface ExportLineage extends ModelOperationLineageBase {
  readonly kind: typeof ModelOperationKind.Export;
  readonly exporterId: ExporterId;
  readonly source: ModelState;
}

export type ModelBaseLineage = InitializationLineage | TrainingLineage;
