import {
  deriveEvidenceDigest,
  parseArtifactReference,
  parseJsonValue,
  parseRuntimeSupportId,
  type ArtifactReference,
  type RuntimeSupportId,
} from '@ta-agent/workbench-domain';

import { RuntimeSupportKind, WorkbenchExtensionFamily } from '../../foundation/constants.js';
import type { WorkbenchExtensionRuntime } from '../../foundation/extension-runtime.js';
import {
  invalidExtension,
  parseDomainValue,
  parseExtensionMetadata,
} from '../../foundation/validation.js';
import type { ArtifactMaterialization, MaterializeArtifact, VerifyArtifact } from './contracts.js';

export interface ArtifactHandoffSupportRuntime extends WorkbenchExtensionRuntime<
  typeof WorkbenchExtensionFamily.RuntimeSupport,
  typeof RuntimeSupportKind.ArtifactHandoff
> {
  readonly runtimeSupportId: RuntimeSupportId;
  readonly verify: VerifyArtifact;
  readonly materialize: (
    request: Parameters<MaterializeArtifact>[0],
    options?: Parameters<MaterializeArtifact>[1]
  ) => Promise<ArtifactMaterialization>;
}

export interface ArtifactHandoffSupportRuntimeInput {
  readonly runtimeSupportId: string;
  readonly metadata?: unknown;
  readonly verify: VerifyArtifact;
  readonly materialize: MaterializeArtifact;
}

export function defineArtifactHandoffSupport(
  input: ArtifactHandoffSupportRuntimeInput
): ArtifactHandoffSupportRuntime {
  requireFunction(input.verify, 'artifactHandoffSupport.verify');
  requireFunction(input.materialize, 'artifactHandoffSupport.materialize');
  const runtimeSupportId = parseDomainValue(
    () => parseRuntimeSupportId(input.runtimeSupportId, 'artifactHandoffSupport.runtimeSupportId'),
    'artifactHandoffSupport.runtimeSupportId'
  );
  const metadata = parseExtensionMetadata(input.metadata, 'artifactHandoffSupport.metadata');
  const evidence = parseJsonValue({
    family: WorkbenchExtensionFamily.RuntimeSupport,
    kind: RuntimeSupportKind.ArtifactHandoff,
    runtimeSupportId,
    ...(metadata === undefined ? {} : { metadata }),
  });

  return Object.freeze({
    family: WorkbenchExtensionFamily.RuntimeSupport,
    kind: RuntimeSupportKind.ArtifactHandoff,
    runtimeSupportId,
    ...(metadata === undefined ? {} : { metadata }),
    evidenceDigest: deriveEvidenceDigest(evidence),
    verify: async (
      request: Parameters<VerifyArtifact>[0],
      options?: Parameters<VerifyArtifact>[1]
    ) => {
      const artifact = parseOwnedArtifact(
        runtimeSupportId,
        request.artifact,
        'artifactHandoffSupport.verification.artifact'
      );
      await input.verify(Object.freeze({ artifact }), options);
    },
    materialize: async (
      request: Parameters<MaterializeArtifact>[0],
      options?: Parameters<MaterializeArtifact>[1]
    ) => {
      const artifact = parseOwnedArtifact(
        runtimeSupportId,
        request.artifact,
        'artifactHandoffSupport.materialization.artifact'
      );
      const binding = parseJsonValue(
        await input.materialize(Object.freeze({ artifact }), options),
        'artifactHandoffSupport.materialization.binding'
      );
      return Object.freeze({
        artifactId: artifact.artifactId,
        digest: artifact.digest,
        binding,
      });
    },
  });
}

function parseOwnedArtifact(
  runtimeSupportId: RuntimeSupportId,
  input: unknown,
  path: string
): ArtifactReference {
  const artifact = parseArtifactReference(input, path);
  assertOwnsArtifact(runtimeSupportId, artifact.handoff.runtimeSupportId);
  return artifact;
}

function requireFunction(input: unknown, path: string): void {
  if (typeof input !== 'function') invalidExtension(path, 'must be a function');
}

function assertOwnsArtifact(
  expectedRuntimeSupportId: RuntimeSupportId,
  observedRuntimeSupportId: RuntimeSupportId
): void {
  if (observedRuntimeSupportId !== expectedRuntimeSupportId) {
    invalidExtension(
      'artifact.handoff.runtimeSupportId',
      `must equal bound Runtime Support "${expectedRuntimeSupportId}"`
    );
  }
}
