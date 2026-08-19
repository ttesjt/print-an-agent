import type { ArtifactReference } from './artifact.js';
import type { InitializationLineage, ModelBaseLineage, TrainingLineage } from './lineage.js';
import type { BaseId, ProfileId } from '../foundation/identifiers.js';
import { ModelAssetKind } from './constants.js';

export interface ModelBase<TLineage extends ModelBaseLineage = ModelBaseLineage> {
  readonly kind: typeof ModelAssetKind.Base;
  readonly baseId: BaseId;
  readonly profileId: ProfileId;
  readonly artifact: ArtifactReference;
  readonly lineage: TLineage;
}

export type InitializationModelBase = ModelBase<InitializationLineage>;
export type TrainingModelBase = ModelBase<TrainingLineage>;

export function defineModelBase<TLineage extends ModelBaseLineage>(
  input: Omit<ModelBase<TLineage>, 'kind'>
): ModelBase<TLineage> {
  return Object.freeze({
    kind: ModelAssetKind.Base,
    ...input,
    lineage: Object.freeze(input.lineage),
  });
}

export function modelBasesEqual(left: ModelBase, right: ModelBase): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
