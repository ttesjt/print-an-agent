import type { ArtifactReference } from './artifact.js';
import type { TrainingLineage } from './lineage.js';
import type { ModificationId, ProfileId } from '../foundation/identifiers.js';
import { ModelAssetKind } from './constants.js';

export interface ModelModification {
  readonly kind: typeof ModelAssetKind.Modification;
  readonly modificationId: ModificationId;
  readonly profileId: ProfileId;
  readonly artifact: ArtifactReference;
  readonly lineage: TrainingLineage;
}

export function defineModelModification(input: Omit<ModelModification, 'kind'>): ModelModification {
  return Object.freeze({
    kind: ModelAssetKind.Modification,
    ...input,
    lineage: Object.freeze(input.lineage),
  });
}

export function modelModificationsEqual(
  left: ModelModification,
  right: ModelModification
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
