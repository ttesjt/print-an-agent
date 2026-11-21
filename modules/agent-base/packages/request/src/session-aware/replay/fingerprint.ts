import { createHash } from 'node:crypto';
import { AgentRequestError } from '../../errors.js';
import type { RequestFingerprint } from './types/identity.js';

const REQUEST_FINGERPRINT_SCHEMA_VERSION = 1;
const REQUEST_FINGERPRINT_FORMAT = 'request-v1';

const REQUEST_FINGERPRINT_HASH_ALGORITHM = 'sha256';
const REQUEST_FINGERPRINT_PATTERN = new RegExp(
  `^${REQUEST_FINGERPRINT_FORMAT}:${REQUEST_FINGERPRINT_HASH_ALGORITHM}:[a-f0-9]{64}$`
);

export interface RequestFingerprintManifestV1 {
  readonly message: string;
}

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseFingerprintManifest(value: unknown): RequestFingerprintManifestV1 {
  if (!isUnknownRecord(value)) {
    throw new AgentRequestError(
      'REQUEST_REPLAY_FINGERPRINT_INVALID',
      'Request fingerprint manifest must be an object containing only a message string.'
    );
  }
  const keys = Object.keys(value);
  if (keys.length !== 1 || keys[0] !== 'message' || typeof value.message !== 'string') {
    throw new AgentRequestError(
      'REQUEST_REPLAY_FINGERPRINT_INVALID',
      'Request fingerprint manifest must be an object containing only a message string.'
    );
  }
  return Object.freeze({ message: value.message });
}

export function createRequestFingerprint(
  manifest: RequestFingerprintManifestV1
): RequestFingerprint {
  const parsedManifest = parseFingerprintManifest(manifest);
  const canonicalRecord = JSON.stringify({
    schemaVersion: REQUEST_FINGERPRINT_SCHEMA_VERSION,
    message: parsedManifest.message,
  });
  const digest = createHash(REQUEST_FINGERPRINT_HASH_ALGORITHM)
    .update(canonicalRecord, 'utf8')
    .digest('hex');
  return parseRequestFingerprint(
    `${REQUEST_FINGERPRINT_FORMAT}:${REQUEST_FINGERPRINT_HASH_ALGORITHM}:${digest}`
  );
}

export function parseRequestFingerprint(value: unknown): RequestFingerprint {
  if (typeof value !== 'string' || !REQUEST_FINGERPRINT_PATTERN.test(value)) {
    throw new AgentRequestError(
      'REQUEST_REPLAY_FINGERPRINT_INVALID',
      'Request replay fingerprint must use the supported request-v1:sha256 format with a lowercase hexadecimal digest.'
    );
  }
  return value as RequestFingerprint;
}
