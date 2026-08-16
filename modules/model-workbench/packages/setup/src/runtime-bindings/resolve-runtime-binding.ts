import {
  deriveEvidenceDigest,
  parseJsonValue,
  parseRuntimeBindingId,
  parseRuntimeSupportId,
} from '@ta-agent/workbench-domain';
import type { ArtifactVerifierSupportRuntime } from '@ta-agent/workbench-extension';

import { RuntimeBindingKind } from '../foundation/constants.js';
import {
  invalidSetup,
  parseClosedRecord,
  parseDomainValue,
  parseOptionalMetadata,
} from '../foundation/parsing.js';
import { runtimeSupportEvidence } from '../resolution/evidence.js';
import type { ResolvedRuntimeBinding } from './contracts.js';

export function resolveRuntimeBinding(
  input: unknown,
  index: number,
  supportById: ReadonlyMap<string, ArtifactVerifierSupportRuntime>
): ResolvedRuntimeBinding {
  const path = `setup.runtimeBindings[${String(index)}]`;
  const record = parseClosedRecord(
    input,
    path,
    ['kind', 'runtimeBindingId', 'supports'],
    ['metadata']
  );
  if (record.kind !== RuntimeBindingKind.Binding) {
    invalidSetup(`${path}.kind`, `must equal ${RuntimeBindingKind.Binding}`);
  }
  const runtimeBindingId = parseDomainValue(
    () => parseRuntimeBindingId(record.runtimeBindingId, `${path}.runtimeBindingId`),
    `${path}.runtimeBindingId`
  );
  const supportsRecord = parseClosedRecord(record.supports, `${path}.supports`, [
    'artifactVerifierId',
  ]);
  const artifactVerifierId = parseDomainValue(
    () =>
      parseRuntimeSupportId(
        supportsRecord.artifactVerifierId,
        `${path}.supports.artifactVerifierId`
      ),
    `${path}.supports.artifactVerifierId`
  );
  const artifactVerifier = supportById.get(artifactVerifierId);
  if (artifactVerifier === undefined) {
    invalidSetup(
      `${path}.supports.artifactVerifierId`,
      `references unknown Runtime Support "${artifactVerifierId}"`
    );
  }
  const metadata = parseOptionalMetadata(record, path);
  const evidence = parseJsonValue({
    kind: RuntimeBindingKind.Binding,
    runtimeBindingId,
    supports: { artifactVerifier: runtimeSupportEvidence(artifactVerifier) },
    ...(metadata === undefined ? {} : { metadata }),
  });
  return Object.freeze({
    kind: RuntimeBindingKind.Binding,
    runtimeBindingId,
    supports: Object.freeze({ artifactVerifier }),
    ...(metadata === undefined ? {} : { metadata }),
    evidenceDigest: deriveEvidenceDigest(evidence),
  });
}
