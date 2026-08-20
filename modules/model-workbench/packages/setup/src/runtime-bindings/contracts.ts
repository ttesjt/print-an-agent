import type { JsonValue, RuntimeBindingId, Sha256Digest } from '@ta-agent/workbench-domain';
import type {
  ArtifactHandoffSupportRuntime,
  ExecutionSupportRuntime,
} from '@ta-agent/workbench-extension';

import { RuntimeBindingKind } from '../foundation/constants.js';

export interface RuntimeSupportSelectorsInput {
  readonly artifactHandoffId: string;
  readonly executionSupportId?: string;
}

export interface RuntimeBindingInput {
  readonly kind: typeof RuntimeBindingKind.Binding;
  readonly runtimeBindingId: string;
  readonly supports: RuntimeSupportSelectorsInput;
  readonly metadata?: unknown;
}

export interface ResolvedRuntimeSupports {
  readonly artifactHandoff: ArtifactHandoffSupportRuntime;
  readonly execution?: ExecutionSupportRuntime;
}

export interface ResolvedRuntimeBinding {
  readonly kind: typeof RuntimeBindingKind.Binding;
  readonly runtimeBindingId: RuntimeBindingId;
  readonly supports: ResolvedRuntimeSupports;
  readonly metadata?: JsonValue;
  readonly evidenceDigest: Sha256Digest;
}

export interface ResolvedExecutionRuntimeBinding extends ResolvedRuntimeBinding {
  readonly supports: ResolvedRuntimeSupports & {
    readonly execution: ExecutionSupportRuntime;
  };
}
