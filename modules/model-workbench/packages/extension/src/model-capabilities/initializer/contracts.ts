import {
  ModelOperationKind,
  parseJsonValue,
  parseSha256Digest,
  type JsonValue,
  type RunId,
  type Sha256Digest,
} from '@ta-agent/workbench-domain';

import type { CapabilityDispatch } from '../../execution-protocol/contracts.js';
import { parseClosedRecord } from '../../foundation/parsing.js';
import type { ExtensionCallOptions } from '../../foundation/extension-runtime.js';

export interface InitializationCapabilityRequest<TInput = JsonValue> {
  readonly operation: typeof ModelOperationKind.Initialization;
  readonly runId: RunId;
  readonly input: TInput;
}

export type InitializeCapability<TInput = JsonValue> = (
  request: InitializationCapabilityRequest<TInput>,
  options?: ExtensionCallOptions
) => Promise<CapabilityDispatch<InitializationCapabilityResult>>;

export interface InitializationCapabilityResultInput<TData = JsonValue> {
  readonly artifact: {
    readonly digest: string;
    readonly receipt: unknown;
  };
  readonly data?: TData;
}

export interface InitializationCapabilityResult {
  readonly artifact: {
    readonly digest: Sha256Digest;
    readonly receipt: JsonValue;
  };
  readonly data?: JsonValue;
}

export function parseInitializationCapabilityResult(
  input: unknown,
  path = 'result'
): InitializationCapabilityResult {
  const record = parseClosedRecord(input, path, ['artifact'], ['data']);
  const artifact = parseClosedRecord(record.artifact, `${path}.artifact`, ['digest', 'receipt']);
  return Object.freeze({
    artifact: Object.freeze({
      digest: parseSha256Digest(artifact.digest, `${path}.artifact.digest`),
      receipt: parseJsonValue(artifact.receipt, `${path}.artifact.receipt`),
    }),
    ...(Object.hasOwn(record, 'data') ? { data: parseJsonValue(record.data, `${path}.data`) } : {}),
  });
}
