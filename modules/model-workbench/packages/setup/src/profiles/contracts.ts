import type {
  InitializerId,
  ModelProfile,
  ProfileId,
  Sha256Digest,
  TrainerId,
} from '@ta-agent/workbench-domain';
import type {
  InitializerCapabilityRuntime,
  TrainerCapabilityRuntime,
} from '@ta-agent/workbench-extension';

import type { ResolvedRuntimeBinding } from '../runtime-bindings/contracts.js';

export interface ProfileInitializerSlotInput {
  readonly initializerId: string;
  readonly capabilityId: string;
  readonly runtimeBindingId: string;
}

export interface ProfileTrainerSlotInput {
  readonly trainerId: string;
  readonly capabilityId: string;
  readonly runtimeBindingId: string;
}

export interface ModelProfileInput {
  readonly profileId: string;
  readonly initializers: readonly ProfileInitializerSlotInput[];
  readonly trainers?: readonly ProfileTrainerSlotInput[];
}

export interface ResolvedInitializerSlot {
  readonly initializerId: InitializerId;
  readonly capability: InitializerCapabilityRuntime;
  readonly runtime: ResolvedRuntimeBinding;
  readonly evidenceDigest: Sha256Digest;
}

export interface ResolvedTrainerSlot {
  readonly trainerId: TrainerId;
  readonly capability: TrainerCapabilityRuntime;
  readonly runtime: ResolvedRuntimeBinding;
  readonly evidenceDigest: Sha256Digest;
}

export interface ResolvedModelProfile {
  readonly profileId: ProfileId;
  readonly source: ModelProfile;
  readonly initializers: readonly ResolvedInitializerSlot[];
  readonly trainers: readonly ResolvedTrainerSlot[];
  readonly evidenceDigest: Sha256Digest;
}
