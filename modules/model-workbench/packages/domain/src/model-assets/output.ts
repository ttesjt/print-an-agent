import {
  parseOutputArtifactName,
  parseOutputId,
  parseProfileId,
  type OutputArtifactName,
  type OutputId,
  type ProfileId,
} from '../foundation/identifiers.js';
import { InvalidWorkbenchValueError } from '../foundation/errors.js';
import { canonicalJson, parseJsonValue } from '../foundation/json.js';
import { parseClosedRecord, parseLiteral } from '../foundation/record-parser.js';
import { parseArtifactReference, type ArtifactReference } from './artifact.js';
import { ModelAssetKind } from './constants.js';
import { parseExportLineage, type ExportLineage } from './lineage.js';

export interface NamedOutputArtifact {
  readonly name: OutputArtifactName;
  readonly artifact: ArtifactReference;
}

/** An immutable runtime-oriented Artifact set exported from one exact Model State. */
export interface ModelOutput {
  readonly kind: typeof ModelAssetKind.Output;
  readonly outputId: OutputId;
  readonly profileId: ProfileId;
  readonly artifacts: readonly NamedOutputArtifact[];
  readonly lineage: ExportLineage;
}

export function defineModelOutput(input: Omit<ModelOutput, 'kind'>): ModelOutput {
  if (input.artifacts.length === 0) {
    throw new InvalidWorkbenchValueError('modelOutput.artifacts', 'must be a non-empty array');
  }
  const names = new Set<OutputArtifactName>();
  for (const artifact of input.artifacts) {
    if (names.has(artifact.name)) {
      throw new InvalidWorkbenchValueError(
        'modelOutput.artifacts',
        `must contain unique names; received duplicate "${artifact.name}"`
      );
    }
    names.add(artifact.name);
  }
  return Object.freeze({
    kind: ModelAssetKind.Output,
    ...input,
    artifacts: Object.freeze(
      [...input.artifacts]
        .sort((left, right) => left.name.localeCompare(right.name))
        .map((artifact) => Object.freeze(artifact))
    ),
    lineage: Object.freeze(input.lineage),
  });
}

export function parseModelOutput(input: unknown, path = 'modelOutput'): ModelOutput {
  const record = parseClosedRecord(input, path, [
    'kind',
    'outputId',
    'profileId',
    'artifacts',
    'lineage',
  ]);
  parseLiteral(record.kind, ModelAssetKind.Output, `${path}.kind`);
  if (!Array.isArray(record.artifacts)) {
    throw new InvalidWorkbenchValueError(`${path}.artifacts`, 'must be an array');
  }
  return defineModelOutput({
    outputId: parseOutputId(record.outputId, `${path}.outputId`),
    profileId: parseProfileId(record.profileId, `${path}.profileId`),
    artifacts: record.artifacts.map((value, index) => {
      const artifactPath = `${path}.artifacts[${String(index)}]`;
      const artifact = parseClosedRecord(value, artifactPath, ['name', 'artifact']);
      return Object.freeze({
        name: parseOutputArtifactName(artifact.name, `${artifactPath}.name`),
        artifact: parseArtifactReference(artifact.artifact, `${artifactPath}.artifact`),
      });
    }),
    lineage: parseExportLineage(record.lineage, `${path}.lineage`),
  });
}

export function modelOutputsEqual(left: ModelOutput, right: ModelOutput): boolean {
  return canonicalJson(parseJsonValue(left)) === canonicalJson(parseJsonValue(right));
}
