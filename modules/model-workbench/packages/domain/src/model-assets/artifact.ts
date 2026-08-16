import { InvalidWorkbenchValueError } from '../foundation/errors.js';
import {
  parseArtifactId,
  parseSha256Digest,
  type ArtifactId,
  type Sha256Digest,
} from '../foundation/identifiers.js';

export interface ArtifactReference {
  readonly artifactId: ArtifactId;
  readonly digest: Sha256Digest;
}

export interface ArtifactReferenceInput {
  readonly artifactId: string;
  readonly digest: string;
}

export function parseArtifactReference(input: unknown, path = 'artifact'): ArtifactReference {
  const record = parseClosedRecord(input, path, ['artifactId', 'digest']);
  return Object.freeze({
    artifactId: parseArtifactId(record.artifactId, `${path}.artifactId`),
    digest: parseSha256Digest(record.digest, `${path}.digest`),
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
