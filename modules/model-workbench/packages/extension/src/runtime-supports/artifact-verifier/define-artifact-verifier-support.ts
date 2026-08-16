import {
  deriveEvidenceDigest,
  parseJsonValue,
  parseRuntimeSupportId,
  type RuntimeSupportId,
} from '@ta-agent/workbench-domain';

import { RuntimeSupportKind, WorkbenchExtensionFamily } from '../../foundation/constants.js';
import type { WorkbenchExtensionRuntime } from '../../foundation/extension-runtime.js';
import {
  invalidExtension,
  parseDomainValue,
  parseExtensionMetadata,
} from '../../foundation/validation.js';
import type { VerifyArtifact } from './contracts.js';

export interface ArtifactVerifierSupportRuntime extends WorkbenchExtensionRuntime<
  typeof WorkbenchExtensionFamily.RuntimeSupport,
  typeof RuntimeSupportKind.ArtifactVerifier
> {
  readonly runtimeSupportId: RuntimeSupportId;
  readonly verify: VerifyArtifact;
}

export interface ArtifactVerifierSupportRuntimeInput {
  readonly runtimeSupportId: string;
  readonly metadata?: unknown;
  readonly verify: VerifyArtifact;
}

export function defineArtifactVerifierSupport(
  input: ArtifactVerifierSupportRuntimeInput
): ArtifactVerifierSupportRuntime {
  if (typeof input.verify !== 'function') {
    invalidExtension('artifactVerifierSupport.verify', 'must be a function');
  }
  const runtimeSupportId = parseDomainValue(
    () => parseRuntimeSupportId(input.runtimeSupportId, 'artifactVerifierSupport.runtimeSupportId'),
    'artifactVerifierSupport.runtimeSupportId'
  );
  const metadata = parseExtensionMetadata(input.metadata, 'artifactVerifierSupport.metadata');
  const evidence = parseJsonValue({
    family: WorkbenchExtensionFamily.RuntimeSupport,
    kind: RuntimeSupportKind.ArtifactVerifier,
    runtimeSupportId,
    ...(metadata === undefined ? {} : { metadata }),
  });
  return Object.freeze({
    family: WorkbenchExtensionFamily.RuntimeSupport,
    kind: RuntimeSupportKind.ArtifactVerifier,
    runtimeSupportId,
    ...(metadata === undefined ? {} : { metadata }),
    evidenceDigest: deriveEvidenceDigest(evidence),
    verify: input.verify,
  });
}
