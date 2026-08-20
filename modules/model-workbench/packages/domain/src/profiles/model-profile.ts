import type {
  CapabilityId,
  ExporterId,
  InitializerId,
  OutputInvokerId,
  ProfileId,
  RuntimeBindingId,
  TrainerId,
} from '../foundation/identifiers.js';

export interface ProfileInitializerSlot {
  readonly initializerId: InitializerId;
  readonly capabilityId: CapabilityId;
  readonly runtimeBindingId: RuntimeBindingId;
}

export interface ProfileTrainerSlot {
  readonly trainerId: TrainerId;
  readonly capabilityId: CapabilityId;
  readonly runtimeBindingId: RuntimeBindingId;
}

export interface ProfileExporterSlot {
  readonly exporterId: ExporterId;
  readonly capabilityId: CapabilityId;
  readonly runtimeBindingId: RuntimeBindingId;
}

export interface ProfileOutputInvokerSlot {
  readonly outputInvokerId: OutputInvokerId;
  readonly capabilityId: CapabilityId;
  readonly runtimeBindingId: RuntimeBindingId;
}

export interface ModelProfile {
  readonly profileId: ProfileId;
  readonly initializers: readonly ProfileInitializerSlot[];
  readonly trainers: readonly ProfileTrainerSlot[];
  readonly exporters: readonly ProfileExporterSlot[];
  readonly outputInvokers: readonly ProfileOutputInvokerSlot[];
}

export interface ModelProfileInput {
  readonly profileId: ProfileId;
  readonly initializers: readonly ProfileInitializerSlot[];
  readonly trainers?: readonly ProfileTrainerSlot[];
  readonly exporters?: readonly ProfileExporterSlot[];
  readonly outputInvokers?: readonly ProfileOutputInvokerSlot[];
}

export function defineModelProfile(input: ModelProfileInput): ModelProfile {
  return Object.freeze({
    profileId: input.profileId,
    initializers: Object.freeze(
      input.initializers.map((initializer) => Object.freeze(initializer))
    ),
    trainers: Object.freeze((input.trainers ?? []).map((trainer) => Object.freeze(trainer))),
    exporters: Object.freeze((input.exporters ?? []).map((exporter) => Object.freeze(exporter))),
    outputInvokers: Object.freeze(
      (input.outputInvokers ?? []).map((outputInvoker) => Object.freeze(outputInvoker))
    ),
  });
}
