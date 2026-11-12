import {
  InvalidWorkbenchValueError,
  ModelOperationKind,
  parseJsonValue,
  parseOutputArtifactName,
  parseSha256Digest,
  type JsonValue,
  type OutputArtifactName,
  type ProfileId,
  type RunId,
  type Sha256Digest,
} from '@print-an-agent/workbench-domain';

import type { CapabilityDispatch } from '../../execution-protocol/contracts.js';
import type { ExtensionCallOptions } from '../../foundation/extension-runtime.js';
import { parseClosedRecord } from '../../foundation/parsing.js';
import type { MaterializedModelState } from '../shared/materialized-model-state.js';

export interface ExportCapabilityRequest<TInput = JsonValue> {
  readonly operation: typeof ModelOperationKind.Export;
  readonly profileId: ProfileId;
  readonly runId: RunId;
  readonly source: MaterializedModelState;
  readonly input: TInput;
}

export type ExportCapability<TInput = JsonValue> = (
  request: ExportCapabilityRequest<TInput>,
  options?: ExtensionCallOptions
) => Promise<CapabilityDispatch<ExportCapabilityResult>>;

export interface ExportedArtifactInput {
  readonly name: string;
  readonly artifact: {
    readonly digest: string;
    readonly receipt: unknown;
  };
}

export interface ExportedArtifact {
  readonly name: OutputArtifactName;
  readonly artifact: {
    readonly digest: Sha256Digest;
    readonly receipt: JsonValue;
  };
}

export interface ExportCapabilityResultInput<TData = JsonValue> {
  readonly artifacts: readonly ExportedArtifactInput[];
  readonly data?: TData;
}

export interface ExportCapabilityResult {
  readonly artifacts: readonly ExportedArtifact[];
  readonly data?: JsonValue;
}

export function parseExportCapabilityResult(
  input: unknown,
  path = 'result'
): ExportCapabilityResult {
  const record = parseClosedRecord(input, path, ['artifacts'], ['data']);
  if (!Array.isArray(record.artifacts) || record.artifacts.length === 0) {
    throw new InvalidWorkbenchValueError(`${path}.artifacts`, 'must be a non-empty array');
  }
  const names = new Set<string>();
  const artifacts = Object.freeze(
    record.artifacts
      .map((value, index) => parseExportedArtifact(value, `${path}.artifacts[${String(index)}]`))
      .sort((left, right) => left.name.localeCompare(right.name))
  );
  for (const artifact of artifacts) {
    if (names.has(artifact.name)) {
      throw new InvalidWorkbenchValueError(
        `${path}.artifacts`,
        `must contain unique names; received duplicate "${artifact.name}"`
      );
    }
    names.add(artifact.name);
  }
  return Object.freeze({
    artifacts,
    ...(Object.hasOwn(record, 'data') ? { data: parseJsonValue(record.data, `${path}.data`) } : {}),
  });
}

function parseExportedArtifact(input: unknown, path: string): ExportedArtifact {
  const record = parseClosedRecord(input, path, ['name', 'artifact']);
  const artifact = parseClosedRecord(record.artifact, `${path}.artifact`, ['digest', 'receipt']);
  return Object.freeze({
    name: parseOutputArtifactName(record.name, `${path}.name`),
    artifact: Object.freeze({
      digest: parseSha256Digest(artifact.digest, `${path}.artifact.digest`),
      receipt: parseJsonValue(artifact.receipt, `${path}.artifact.receipt`),
    }),
  });
}
