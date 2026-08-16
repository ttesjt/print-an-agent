import { createHash } from 'node:crypto';

import { parseSha256Digest, type Sha256Digest } from './identifiers.js';
import { canonicalJson, type JsonValue } from './json.js';

export function deriveEvidenceDigest(evidence: JsonValue): Sha256Digest {
  const digest = createHash('sha256').update(canonicalJson(evidence), 'utf8').digest('hex');
  return parseSha256Digest(`sha256:${digest}`, 'derivedEvidenceDigest');
}
