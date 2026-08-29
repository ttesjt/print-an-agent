import { parseArtifactReference, type ArtifactReference } from './artifact.js';
import {
  parseInitializationLineage,
  parseTrainingLineage,
  type InitializationLineage,
  type ModelBaseLineage,
  type TrainingLineage,
} from './lineage.js';
import {
  parseBaseId,
  parseProfileId,
  type BaseId,
  type ProfileId,
} from '../foundation/identifiers.js';
import { canonicalJson, parseJsonValue } from '../foundation/json.js';
import { parseClosedRecord, parseLiteral, parseStringUnion } from '../foundation/record-parser.js';
import { ModelOperationKind } from '../operations/constants.js';
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

const baseLineageKinds = new Set([ModelOperationKind.Initialization, ModelOperationKind.Training]);

export function parseModelBase(input: unknown, path = 'modelBase'): ModelBase {
  const record = parseClosedRecord(input, path, [
    'kind',
    'baseId',
    'profileId',
    'artifact',
    'lineage',
  ]);
  parseLiteral(record.kind, ModelAssetKind.Base, `${path}.kind`);
  const lineageRecord = parseClosedRecord(
    record.lineage,
    `${path}.lineage`,
    ['kind'],
    [
      'runId',
      'initializerId',
      'trainerId',
      'capabilityId',
      'runtimeBindingId',
      'slotEvidenceDigest',
      'source',
    ]
  );
  const lineageKind = parseStringUnion(
    lineageRecord.kind,
    baseLineageKinds,
    `${path}.lineage.kind`
  );
  const lineage =
    lineageKind === ModelOperationKind.Initialization
      ? parseInitializationLineage(record.lineage, `${path}.lineage`)
      : parseTrainingLineage(record.lineage, `${path}.lineage`);
  return defineModelBase({
    baseId: parseBaseId(record.baseId, `${path}.baseId`),
    profileId: parseProfileId(record.profileId, `${path}.profileId`),
    artifact: parseArtifactReference(record.artifact, `${path}.artifact`),
    lineage,
  });
}

export function modelBasesEqual(left: ModelBase, right: ModelBase): boolean {
  return canonicalJson(parseJsonValue(left)) === canonicalJson(parseJsonValue(right));
}
