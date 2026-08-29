import { parseArtifactReference, type ArtifactReference } from './artifact.js';
import { parseTrainingLineage, type TrainingLineage } from './lineage.js';
import {
  parseModificationId,
  parseProfileId,
  type ModificationId,
  type ProfileId,
} from '../foundation/identifiers.js';
import { canonicalJson, parseJsonValue } from '../foundation/json.js';
import { parseClosedRecord, parseLiteral } from '../foundation/record-parser.js';
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

export function parseModelModification(
  input: unknown,
  path = 'modelModification'
): ModelModification {
  const record = parseClosedRecord(input, path, [
    'kind',
    'modificationId',
    'profileId',
    'artifact',
    'lineage',
  ]);
  parseLiteral(record.kind, ModelAssetKind.Modification, `${path}.kind`);
  return defineModelModification({
    modificationId: parseModificationId(record.modificationId, `${path}.modificationId`),
    profileId: parseProfileId(record.profileId, `${path}.profileId`),
    artifact: parseArtifactReference(record.artifact, `${path}.artifact`),
    lineage: parseTrainingLineage(record.lineage, `${path}.lineage`),
  });
}

export function modelModificationsEqual(
  left: ModelModification,
  right: ModelModification
): boolean {
  return canonicalJson(parseJsonValue(left)) === canonicalJson(parseJsonValue(right));
}
