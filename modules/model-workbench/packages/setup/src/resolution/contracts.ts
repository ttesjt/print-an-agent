import type { Sha256Digest } from '@ta-agent/workbench-domain';
import type {
  ArtifactHandoffSupportRuntime,
  ExecutionSupportRuntime,
  InitializerCapabilityRuntime,
  TrainerCapabilityRuntime,
} from '@ta-agent/workbench-extension';

import { WorkbenchSetupKind } from '../foundation/constants.js';
import type { ModelProfileInput, ResolvedModelProfile } from '../profiles/contracts.js';
import type { RuntimeBindingInput } from '../runtime-bindings/contracts.js';

export interface WorkbenchSetupInput {
  readonly runtimeBindings: readonly RuntimeBindingInput[];
  readonly profiles: readonly ModelProfileInput[];
}

export interface WorkbenchExtensionResources {
  readonly modelCapabilities: readonly (InitializerCapabilityRuntime | TrainerCapabilityRuntime)[];
  readonly runtimeSupports: readonly (ArtifactHandoffSupportRuntime | ExecutionSupportRuntime)[];
}

export interface ResolvedWorkbenchSetup {
  readonly kind: typeof WorkbenchSetupKind.Resolved;
  readonly profiles: readonly ResolvedModelProfile[];
  readonly artifactHandoffSupports: readonly ArtifactHandoffSupportRuntime[];
  readonly evidenceDigest: Sha256Digest;
}
