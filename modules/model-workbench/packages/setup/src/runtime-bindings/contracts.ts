import type { JsonValue, RuntimeBindingId, Sha256Digest } from '@ta-agent/workbench-domain';
import type { ArtifactVerifierSupportRuntime } from '@ta-agent/workbench-extension';

import { RuntimeBindingKind } from '../foundation/constants.js';

export interface RuntimeSupportSelectorsInput {
  readonly artifactVerifierId: string;
}

export interface RuntimeBindingInput {
  readonly kind: typeof RuntimeBindingKind.Binding;
  readonly runtimeBindingId: string;
  readonly supports: RuntimeSupportSelectorsInput;
  readonly metadata?: unknown;
}

export interface ResolvedRuntimeSupports {
  readonly artifactVerifier: ArtifactVerifierSupportRuntime;
}

export interface ResolvedRuntimeBinding {
  readonly kind: typeof RuntimeBindingKind.Binding;
  readonly runtimeBindingId: RuntimeBindingId;
  readonly supports: ResolvedRuntimeSupports;
  readonly metadata?: JsonValue;
  readonly evidenceDigest: Sha256Digest;
}
