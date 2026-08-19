import {
  deriveEvidenceDigest,
  parseJsonValue,
  type ModelProfile,
} from '@ta-agent/workbench-domain';
import type { InitializerCapabilityRuntime } from '@ta-agent/workbench-extension';
import { ModelCapabilityKind, type TrainerCapabilityRuntime } from '@ta-agent/workbench-extension';

import { invalidSetup, sortBy } from '../foundation/parsing.js';
import {
  capabilityEvidence,
  initializerSlotEvidence,
  runtimeBindingEvidence,
  trainerSlotEvidence,
} from '../resolution/evidence.js';
import type { ResolvedRuntimeBinding } from '../runtime-bindings/contracts.js';
import type {
  ResolvedInitializerSlot,
  ResolvedModelProfile,
  ResolvedTrainerSlot,
} from './contracts.js';
import { parseModelProfile } from './parse-model-profile.js';

export function resolveModelProfile(
  input: unknown,
  index: number,
  capabilityById: ReadonlyMap<string, InitializerCapabilityRuntime | TrainerCapabilityRuntime>,
  runtimeBindingById: ReadonlyMap<string, ResolvedRuntimeBinding>
): ResolvedModelProfile {
  const source = parseModelProfile(input, index);
  const profilePath = `setup.profiles[${String(index)}]`;
  const initializers = source.initializers.map((initializer, initializerIndex) =>
    resolveInitializerSlot(
      initializer,
      `${profilePath}.initializers[${String(initializerIndex)}]`,
      capabilityById,
      runtimeBindingById
    )
  );
  const sortedInitializers = sortBy(initializers, ({ initializerId }) => initializerId);
  const trainers = source.trainers.map((trainer, trainerIndex) =>
    resolveTrainerSlot(
      trainer,
      `${profilePath}.trainers[${String(trainerIndex)}]`,
      capabilityById,
      runtimeBindingById
    )
  );
  const sortedTrainers = sortBy(trainers, ({ trainerId }) => trainerId);
  const evidence = parseJsonValue({
    profileId: source.profileId,
    initializers: sortedInitializers.map(initializerSlotEvidence),
    trainers: sortedTrainers.map(trainerSlotEvidence),
  });
  return Object.freeze({
    profileId: source.profileId,
    source,
    initializers: sortedInitializers,
    trainers: sortedTrainers,
    evidenceDigest: deriveEvidenceDigest(evidence),
  });
}

function resolveInitializerSlot(
  source: ModelProfile['initializers'][number],
  path: string,
  capabilityById: ReadonlyMap<string, InitializerCapabilityRuntime | TrainerCapabilityRuntime>,
  runtimeBindingById: ReadonlyMap<string, ResolvedRuntimeBinding>
): ResolvedInitializerSlot {
  const capability = requireCapability(
    capabilityById,
    source.capabilityId,
    ModelCapabilityKind.Initializer,
    `${path}.capabilityId`
  );
  const runtime = runtimeBindingById.get(source.runtimeBindingId);
  if (runtime === undefined) {
    invalidSetup(
      `${path}.runtimeBindingId`,
      `references unknown Runtime Binding "${source.runtimeBindingId}"`
    );
  }
  const evidence = parseJsonValue({
    initializerId: source.initializerId,
    capability: capabilityEvidence(capability),
    runtime: runtimeBindingEvidence(runtime),
  });
  return Object.freeze({
    initializerId: source.initializerId,
    capability,
    runtime,
    evidenceDigest: deriveEvidenceDigest(evidence),
  });
}

function resolveTrainerSlot(
  source: ModelProfile['trainers'][number],
  path: string,
  capabilityById: ReadonlyMap<string, InitializerCapabilityRuntime | TrainerCapabilityRuntime>,
  runtimeBindingById: ReadonlyMap<string, ResolvedRuntimeBinding>
): ResolvedTrainerSlot {
  const capability = requireCapability(
    capabilityById,
    source.capabilityId,
    ModelCapabilityKind.Trainer,
    `${path}.capabilityId`
  );
  const runtime = runtimeBindingById.get(source.runtimeBindingId);
  if (runtime === undefined) {
    invalidSetup(
      `${path}.runtimeBindingId`,
      `references unknown Runtime Binding "${source.runtimeBindingId}"`
    );
  }
  const evidence = parseJsonValue({
    trainerId: source.trainerId,
    capability: capabilityEvidence(capability),
    runtime: runtimeBindingEvidence(runtime),
  });
  return Object.freeze({
    trainerId: source.trainerId,
    capability,
    runtime,
    evidenceDigest: deriveEvidenceDigest(evidence),
  });
}

function requireCapability<
  TKind extends typeof ModelCapabilityKind.Initializer | typeof ModelCapabilityKind.Trainer,
>(
  capabilityById: ReadonlyMap<string, InitializerCapabilityRuntime | TrainerCapabilityRuntime>,
  capabilityId: string,
  expectedKind: TKind,
  path: string
): Extract<InitializerCapabilityRuntime | TrainerCapabilityRuntime, { readonly kind: TKind }> {
  const capability = capabilityById.get(capabilityId);
  if (capability === undefined) {
    invalidSetup(path, `references unknown Capability "${capabilityId}"`);
  }
  if (capability.kind !== expectedKind) {
    invalidSetup(path, `must reference Model Capability kind "${expectedKind}"`);
  }
  return capability as Extract<
    InitializerCapabilityRuntime | TrainerCapabilityRuntime,
    { readonly kind: TKind }
  >;
}
