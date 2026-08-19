import { InvalidWorkbenchValueError } from '../foundation/errors.js';
import {
  parseArtifactId,
  parseRuntimeSupportId,
  parseSha256Digest,
  type ArtifactId,
  type RuntimeSupportId,
  type Sha256Digest,
} from '../foundation/identifiers.js';
import { parseJsonValue, type JsonValue } from '../foundation/json.js';

export interface ArtifactHandoff {
  readonly runtimeSupportId: RuntimeSupportId;
  readonly receipt: JsonValue;
}

export interface ArtifactReference {
  readonly artifactId: ArtifactId;
  readonly digest: Sha256Digest;
  readonly handoff: ArtifactHandoff;
}

export interface ArtifactReferenceInput {
  readonly artifactId: string;
  readonly digest: string;
  readonly handoff: {
    readonly runtimeSupportId: string;
    readonly receipt: unknown;
  };
}

export function parseArtifactReference(input: unknown, path = 'artifact'): ArtifactReference {
  const record = parseClosedRecord(input, path, ['artifactId', 'digest', 'handoff']);
  const handoff = parseClosedRecord(record.handoff, `${path}.handoff`, [
    'runtimeSupportId',
    'receipt',
  ]);
  return Object.freeze({
    artifactId: parseArtifactId(record.artifactId, `${path}.artifactId`),
    digest: parseSha256Digest(record.digest, `${path}.digest`),
    handoff: Object.freeze({
      runtimeSupportId: parseRuntimeSupportId(
        handoff.runtimeSupportId,
        `${path}.handoff.runtimeSupportId`
      ),
      receipt: parseJsonValue(handoff.receipt, `${path}.handoff.receipt`),
    }),
  });
}

function parseClosedRecord(
  input: unknown,
  path: string,
  keys: readonly string[]
): Readonly<Record<string, unknown>> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new InvalidWorkbenchValueError(path, 'must be an object');
  }
  const prototype: unknown = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new InvalidWorkbenchValueError(path, 'must be a plain object');
  }
  const record = input as Readonly<Record<string, unknown>>;
  const allowed = new Set(keys);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) throw new InvalidWorkbenchValueError(`${path}.${key}`, 'is not allowed');
  }
  for (const key of keys) {
    if (!Object.hasOwn(record, key)) {
      throw new InvalidWorkbenchValueError(`${path}.${key}`, 'is required');
    }
  }
  return record;
}
