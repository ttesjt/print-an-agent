import type {
  ExporterId,
  InitializerId,
  ModelProfile,
  OutputInvokerId,
  ProfileId,
  JsonObject,
  Sha256Digest,
  TrainerId,
} from '@ta-agent/workbench-domain';
import type {
  ArtifactHandoffSupportRuntime,
  ExporterCapabilityRuntime,
  InitializerCapabilityRuntime,
  OutputInvokerCapabilityRuntime,
  TrainerCapabilityRuntime,
} from '@ta-agent/workbench-extension';

import type {
  ResolvedExecutionRuntimeBinding,
  ResolvedRuntimeBinding,
} from '../runtime-bindings/contracts.js';

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

export interface ProfileExporterSlotInput {
  readonly exporterId: string;
  readonly capabilityId: string;
  readonly runtimeBindingId: string;
}

export interface ProfileOutputInvokerSlotInput {
  readonly outputInvokerId: string;
  readonly capabilityId: string;
  readonly runtimeBindingId: string;
}

export interface ModelProfileInput {
  readonly profileId: string;
  readonly canonicalOutputInvokerId?: string;
  readonly infrastructure?: ProfileInfrastructureInput;
  readonly initializers: readonly ProfileInitializerSlotInput[];
  readonly trainers?: readonly ProfileTrainerSlotInput[];
  readonly exporters?: readonly ProfileExporterSlotInput[];
  readonly outputInvokers?: readonly ProfileOutputInvokerSlotInput[];
}

export interface ProfileInfrastructureInput {
  readonly persistence?: {
    readonly configuration?: unknown;
  };
}

export interface ResolvedProfileInfrastructure {
  readonly persistence: {
    readonly configuration?: JsonObject;
  };
}

export interface ResolvedInitializerSlot {
  readonly initializerId: InitializerId;
  readonly capability: InitializerCapabilityRuntime;
  readonly runtime: ResolvedExecutionRuntimeBinding;
  readonly evidenceDigest: Sha256Digest;
}

export interface ResolvedTrainerSlot {
  readonly trainerId: TrainerId;
  readonly capability: TrainerCapabilityRuntime;
  readonly runtime: ResolvedExecutionRuntimeBinding;
  readonly evidenceDigest: Sha256Digest;
}

export interface ResolvedExporterSlot {
  readonly exporterId: ExporterId;
  readonly capability: ExporterCapabilityRuntime;
  readonly runtime: ResolvedExecutionRuntimeBinding;
  readonly evidenceDigest: Sha256Digest;
}

export interface ResolvedOutputInvokerSlot {
  readonly outputInvokerId: OutputInvokerId;
  readonly capability: OutputInvokerCapabilityRuntime;
  readonly runtime: ResolvedRuntimeBinding;
  readonly evidenceDigest: Sha256Digest;
}

export interface ResolvedModelProfile {
  readonly profileId: ProfileId;
  readonly source: ModelProfile;
  readonly infrastructure: ResolvedProfileInfrastructure;
  readonly initializers: readonly ResolvedInitializerSlot[];
  readonly trainers: readonly ResolvedTrainerSlot[];
  readonly exporters: readonly ResolvedExporterSlot[];
  readonly outputInvokers: readonly ResolvedOutputInvokerSlot[];
  readonly canonicalOutputInvoker: ResolvedOutputInvokerSlot | undefined;
  readonly artifactHandoffSupports: readonly ArtifactHandoffSupportRuntime[];
  readonly evidenceDigest: Sha256Digest;
}
