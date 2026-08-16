import {
  InvalidWorkbenchValueError,
  ModelOperationKind,
  parseArtifactReference,
  parseExecutionFailure,
  parseJsonValue,
  type ArtifactId,
  type ArtifactReference,
  type ExecutionFailure,
  type JsonValue,
  type RunId,
} from '@ta-agent/workbench-domain';

import { CapabilityOutcomeStatus } from '../../foundation/constants.js';
import type { ExtensionCallOptions } from '../../foundation/extension-runtime.js';

export interface InitializationCapabilityRequest<TInput = JsonValue> {
  readonly operation: typeof ModelOperationKind.Initialization;
  readonly runId: RunId;
  readonly plannedArtifactId: ArtifactId;
  readonly input: TInput;
}

export type InitializeCapability<TInput = JsonValue> = (
  request: InitializationCapabilityRequest<TInput>,
  options?: ExtensionCallOptions
) => Promise<unknown>;

export type InitializationCapabilityOutcomeInput<TData = JsonValue> =
  | {
      readonly status: typeof CapabilityOutcomeStatus.Succeeded;
      readonly artifact: {
        readonly artifactId: string;
        readonly digest: string;
      };
      readonly data?: TData;
    }
  | {
      readonly status: typeof CapabilityOutcomeStatus.Failed;
      readonly failure: ExecutionFailure;
    };

export type InitializationCapabilityOutcome =
  | {
      readonly status: typeof CapabilityOutcomeStatus.Succeeded;
      readonly artifact: ArtifactReference;
      readonly data?: JsonValue;
    }
  | {
      readonly status: typeof CapabilityOutcomeStatus.Failed;
      readonly failure: ExecutionFailure;
    };

export function parseInitializationCapabilityOutcome(
  input: unknown,
  path = 'outcome'
): InitializationCapabilityOutcome {
  const record = parseRecord(input, path);
  if (record.status === CapabilityOutcomeStatus.Succeeded) {
    assertKeys(record, path, ['status', 'artifact'], ['data']);
    return Object.freeze({
      status: CapabilityOutcomeStatus.Succeeded,
      artifact: parseArtifactReference(record.artifact, `${path}.artifact`),
      ...(Object.hasOwn(record, 'data')
        ? { data: parseJsonValue(record.data, `${path}.data`) }
        : {}),
    });
  }
  if (record.status === CapabilityOutcomeStatus.Failed) {
    assertKeys(record, path, ['status', 'failure']);
    return Object.freeze({
      status: CapabilityOutcomeStatus.Failed,
      failure: parseExecutionFailure(record.failure, `${path}.failure`),
    });
  }
  throw new InvalidWorkbenchValueError(`${path}.status`, 'must equal succeeded or failed');
}

function parseRecord(input: unknown, path: string): Readonly<Record<string, unknown>> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new InvalidWorkbenchValueError(path, 'must be an object');
  }
  const prototype: unknown = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new InvalidWorkbenchValueError(path, 'must be a plain object');
  }
  return input as Readonly<Record<string, unknown>>;
}

function assertKeys(
  record: Readonly<Record<string, unknown>>,
  path: string,
  required: readonly string[],
  optional: readonly string[] = []
): void {
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) throw new InvalidWorkbenchValueError(`${path}.${key}`, 'is not allowed');
  }
  for (const key of required) {
    if (!Object.hasOwn(record, key)) {
      throw new InvalidWorkbenchValueError(`${path}.${key}`, 'is required');
    }
  }
}
