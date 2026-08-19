import type {
  ArtifactId,
  ArtifactReference,
  JsonValue,
  Sha256Digest,
} from '@ta-agent/workbench-domain';

import type { ExtensionCallOptions } from '../../foundation/extension-runtime.js';

export interface ArtifactVerificationRequest {
  readonly artifact: ArtifactReference;
}

export interface ArtifactMaterializationRequest {
  readonly artifact: ArtifactReference;
}

/** A transient, backend-consumable view of one durable Artifact reference. */
export interface ArtifactMaterialization {
  readonly artifactId: ArtifactId;
  readonly digest: Sha256Digest;
  readonly binding: JsonValue;
}

export type VerifyArtifact = (
  request: ArtifactVerificationRequest,
  options?: ExtensionCallOptions
) => Promise<void>;

export type MaterializeArtifact = (
  request: ArtifactMaterializationRequest,
  options?: ExtensionCallOptions
) => Promise<unknown>;
