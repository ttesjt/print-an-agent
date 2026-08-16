import type {
  InitializerId,
  ModelProfile,
  ProfileId,
  Sha256Digest,
} from '@ta-agent/workbench-domain';
import type { InitializerCapabilityRuntime } from '@ta-agent/workbench-extension';

import type { ResolvedRuntimeBinding } from '../runtime-bindings/contracts.js';

export interface ProfileInitializerSlotInput {
  readonly initializerId: string;
  readonly capabilityId: string;
  readonly runtimeBindingId: string;
}

export interface ModelProfileInput {
  readonly profileId: string;
  readonly initializers: readonly ProfileInitializerSlotInput[];
}

export interface ResolvedInitializerSlot {
  readonly initializerId: InitializerId;
  readonly capability: InitializerCapabilityRuntime;
  readonly runtime: ResolvedRuntimeBinding;
  readonly evidenceDigest: Sha256Digest;
}

export interface ResolvedModelProfile {
  readonly profileId: ProfileId;
  readonly source: ModelProfile;
  readonly initializers: readonly ResolvedInitializerSlot[];
  readonly evidenceDigest: Sha256Digest;
}
