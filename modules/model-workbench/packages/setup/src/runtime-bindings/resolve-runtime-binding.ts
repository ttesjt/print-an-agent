import {
  deriveEvidenceDigest,
  parseJsonValue,
  parseRuntimeBindingId,
  parseRuntimeSupportId,
} from '@ta-agent/workbench-domain';
import {
  RuntimeSupportKind,
  type ArtifactHandoffSupportRuntime,
  type ExecutionSupportRuntime,
} from '@ta-agent/workbench-extension';

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
  supportById: ReadonlyMap<string, ArtifactHandoffSupportRuntime | ExecutionSupportRuntime>
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
  const supportsRecord = parseClosedRecord(
    record.supports,
    `${path}.supports`,
    ['artifactHandoffId'],
    ['executionSupportId']
  );
  const artifactHandoffId = parseDomainValue(
    () =>
      parseRuntimeSupportId(supportsRecord.artifactHandoffId, `${path}.supports.artifactHandoffId`),
    `${path}.supports.artifactHandoffId`
  );
  const artifactHandoff = requireRuntimeSupport(
    supportById,
    artifactHandoffId,
    RuntimeSupportKind.ArtifactHandoff,
    `${path}.supports.artifactHandoffId`
  );
  const execution = Object.hasOwn(supportsRecord, 'executionSupportId')
    ? requireRuntimeSupport(
        supportById,
        parseDomainValue(
          () =>
            parseRuntimeSupportId(
              supportsRecord.executionSupportId,
              `${path}.supports.executionSupportId`
            ),
          `${path}.supports.executionSupportId`
        ),
        RuntimeSupportKind.Execution,
        `${path}.supports.executionSupportId`
      )
    : undefined;
  const metadata = parseOptionalMetadata(record, path);
  const evidence = parseJsonValue({
    kind: RuntimeBindingKind.Binding,
    runtimeBindingId,
    supports: {
      artifactHandoff: runtimeSupportEvidence(artifactHandoff),
      ...(execution === undefined ? {} : { execution: runtimeSupportEvidence(execution) }),
    },
    ...(metadata === undefined ? {} : { metadata }),
  });
  return Object.freeze({
    kind: RuntimeBindingKind.Binding,
    runtimeBindingId,
    supports: Object.freeze({
      artifactHandoff,
      ...(execution === undefined ? {} : { execution }),
    }),
    ...(metadata === undefined ? {} : { metadata }),
    evidenceDigest: deriveEvidenceDigest(evidence),
  });
}

function requireRuntimeSupport<
  TKind extends typeof RuntimeSupportKind.ArtifactHandoff | typeof RuntimeSupportKind.Execution,
>(
  supportById: ReadonlyMap<string, ArtifactHandoffSupportRuntime | ExecutionSupportRuntime>,
  runtimeSupportId: string,
  expectedKind: TKind,
  path: string
): Extract<ArtifactHandoffSupportRuntime | ExecutionSupportRuntime, { readonly kind: TKind }> {
  const support = supportById.get(runtimeSupportId);
  if (support === undefined) {
    invalidSetup(path, `references unknown Runtime Support "${runtimeSupportId}"`);
  }
  if (support.kind !== expectedKind) {
    invalidSetup(path, `must reference Runtime Support kind "${expectedKind}"`);
  }
  return support as Extract<
    ArtifactHandoffSupportRuntime | ExecutionSupportRuntime,
    { readonly kind: TKind }
  >;
}
