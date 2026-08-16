import type { Sha256Digest } from '@ta-agent/workbench-domain';
import type {
  ArtifactVerifierSupportRuntime,
  InitializerCapabilityRuntime,
} from '@ta-agent/workbench-extension';

import { WorkbenchSetupKind } from '../foundation/constants.js';
import type { ModelProfileInput, ResolvedModelProfile } from '../profiles/contracts.js';
import type { RuntimeBindingInput } from '../runtime-bindings/contracts.js';

export interface WorkbenchSetupInput {
  readonly runtimeBindings: readonly RuntimeBindingInput[];
  readonly profiles: readonly ModelProfileInput[];
}

export interface WorkbenchExtensionResources {
  readonly modelCapabilities: readonly InitializerCapabilityRuntime[];
  readonly runtimeSupports: readonly ArtifactVerifierSupportRuntime[];
}

export interface ResolvedWorkbenchSetup {
  readonly kind: typeof WorkbenchSetupKind.Resolved;
  readonly profiles: readonly ResolvedModelProfile[];
  readonly evidenceDigest: Sha256Digest;
}
