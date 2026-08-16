import type { ArtifactReference } from './artifact.js';
import type {
  BaseId,
  CapabilityId,
  InitializerId,
  ProfileId,
  RunId,
  RuntimeBindingId,
  Sha256Digest,
} from '../foundation/identifiers.js';
import { ModelOperationKind } from '../operations/constants.js';
import { ModelAssetKind } from './constants.js';

export interface ModelBase {
  readonly kind: typeof ModelAssetKind.Base;
  readonly baseId: BaseId;
  readonly profileId: ProfileId;
  readonly artifact: ArtifactReference;
  readonly lineage: {
    readonly kind: typeof ModelOperationKind.Initialization;
    readonly runId: RunId;
    readonly initializerId: InitializerId;
    readonly capabilityId: CapabilityId;
    readonly runtimeBindingId: RuntimeBindingId;
    readonly slotEvidenceDigest: Sha256Digest;
  };
}

export function defineModelBase(input: Omit<ModelBase, 'kind'>): ModelBase {
  return Object.freeze({
    kind: ModelAssetKind.Base,
    ...input,
    lineage: Object.freeze(input.lineage),
  });
}

export function modelBasesEqual(left: ModelBase, right: ModelBase): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
