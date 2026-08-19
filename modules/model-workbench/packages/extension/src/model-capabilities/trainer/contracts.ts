import {
  InvalidWorkbenchValueError,
  ModelOperationKind,
  ModelRunResultKind,
  parseJsonValue,
  parseSha256Digest,
  type BaseId,
  type JsonValue,
  type ModelState,
  type ModificationId,
  type RunId,
  type Sha256Digest,
} from '@ta-agent/workbench-domain';

import type { ArtifactMaterialization } from '../../runtime-supports/artifact-handoff/contracts.js';
import type { CapabilityDispatch } from '../../execution-protocol/contracts.js';
import { parseClosedRecord } from '../../foundation/parsing.js';
import type { ExtensionCallOptions } from '../../foundation/extension-runtime.js';

export interface MaterializedBaseParameter {
  readonly baseId: BaseId;
  readonly artifact: ArtifactMaterialization;
}

export interface MaterializedModificationParameter {
  readonly modificationId: ModificationId;
  readonly artifact: ArtifactMaterialization;
}

/** Exact Model State identity plus transient Artifact inputs prepared for one Trainer call. */
export interface MaterializedModelState {
  readonly state: ModelState;
  readonly base: MaterializedBaseParameter;
  readonly modifications: readonly MaterializedModificationParameter[];
}

export interface TrainingCapabilityRequest<TInput = JsonValue> {
  readonly operation: typeof ModelOperationKind.Training;
  readonly runId: RunId;
  readonly source: MaterializedModelState;
  readonly input: TInput;
}

export type TrainCapability<TInput = JsonValue> = (
  request: TrainingCapabilityRequest<TInput>,
  options?: ExtensionCallOptions
) => Promise<CapabilityDispatch<TrainingCapabilityResult>>;

export interface TrainingCapabilityResultInput<TData = JsonValue> {
  readonly assetKind: typeof ModelRunResultKind.Base | typeof ModelRunResultKind.Modification;
  readonly artifact: {
    readonly digest: string;
    readonly receipt: unknown;
  };
  readonly data?: TData;
}

export interface TrainingCapabilityResult {
  readonly assetKind: typeof ModelRunResultKind.Base | typeof ModelRunResultKind.Modification;
  readonly artifact: {
    readonly digest: Sha256Digest;
    readonly receipt: JsonValue;
  };
  readonly data?: JsonValue;
}

export function parseTrainingCapabilityResult(
  input: unknown,
  path = 'result'
): TrainingCapabilityResult {
  const record = parseClosedRecord(input, path, ['assetKind', 'artifact'], ['data']);
  const artifact = parseClosedRecord(record.artifact, `${path}.artifact`, ['digest', 'receipt']);
  return Object.freeze({
    assetKind: parseTrainingAssetKind(record.assetKind, `${path}.assetKind`),
    artifact: Object.freeze({
      digest: parseSha256Digest(artifact.digest, `${path}.artifact.digest`),
      receipt: parseJsonValue(artifact.receipt, `${path}.artifact.receipt`),
    }),
    ...(Object.hasOwn(record, 'data') ? { data: parseJsonValue(record.data, `${path}.data`) } : {}),
  });
}

function parseTrainingAssetKind(
  input: unknown,
  path: string
): TrainingCapabilityResult['assetKind'] {
  if (input === ModelRunResultKind.Base || input === ModelRunResultKind.Modification) return input;
  throw new InvalidWorkbenchValueError(path, 'must equal "base" or "modification"');
}
