import {
  parseArtifactId,
  parseRuntimeSupportId,
  parseSha256Digest,
  type ArtifactId,
  type RuntimeSupportId,
  type Sha256Digest,
} from '../foundation/identifiers.js';
import { parseJsonValue, type JsonValue } from '../foundation/json.js';
import { parseClosedRecord } from '../foundation/record-parser.js';

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
