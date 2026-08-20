import type { OutputArtifactName, OutputId, ProfileId } from '../foundation/identifiers.js';
import { InvalidWorkbenchValueError } from '../foundation/errors.js';
import { canonicalJson, parseJsonValue } from '../foundation/json.js';
import type { ArtifactReference } from './artifact.js';
import { ModelAssetKind } from './constants.js';
import type { ExportLineage } from './lineage.js';

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

export function modelOutputsEqual(left: ModelOutput, right: ModelOutput): boolean {
  return canonicalJson(parseJsonValue(left)) === canonicalJson(parseJsonValue(right));
}
