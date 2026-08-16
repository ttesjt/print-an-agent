import type {
  CapabilityId,
  InitializerId,
  ProfileId,
  RuntimeBindingId,
} from '../foundation/identifiers.js';

export interface ProfileInitializerSlot {
  readonly initializerId: InitializerId;
  readonly capabilityId: CapabilityId;
  readonly runtimeBindingId: RuntimeBindingId;
}

export interface ModelProfile {
  readonly profileId: ProfileId;
  readonly initializers: readonly ProfileInitializerSlot[];
}

export function defineModelProfile(input: ModelProfile): ModelProfile {
  return Object.freeze({
    profileId: input.profileId,
    initializers: Object.freeze(
      input.initializers.map((initializer) => Object.freeze(initializer))
    ),
  });
}
