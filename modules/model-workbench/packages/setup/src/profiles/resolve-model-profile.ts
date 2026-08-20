import {
  deriveEvidenceDigest,
  parseJsonValue,
  type ModelProfile,
} from '@ta-agent/workbench-domain';
import { ModelCapabilityKind, type ModelCapabilityRuntime } from '@ta-agent/workbench-extension';

import { invalidSetup, sortBy } from '../foundation/parsing.js';
import {
  capabilityEvidence,
  exporterSlotEvidence,
  initializerSlotEvidence,
  outputInvokerSlotEvidence,
  runtimeBindingEvidence,
  trainerSlotEvidence,
} from '../resolution/evidence.js';
import type {
  ResolvedExecutionRuntimeBinding,
  ResolvedRuntimeBinding,
} from '../runtime-bindings/contracts.js';
import type {
  ResolvedInitializerSlot,
  ResolvedModelProfile,
  ResolvedExporterSlot,
  ResolvedOutputInvokerSlot,
  ResolvedTrainerSlot,
} from './contracts.js';
import { parseModelProfile } from './parse-model-profile.js';

export function resolveModelProfile(
  input: unknown,
  index: number,
  capabilityById: ReadonlyMap<string, ModelCapabilityRuntime>,
  runtimeBindingById: ReadonlyMap<string, ResolvedRuntimeBinding>
): ResolvedModelProfile {
  const parsed = parseModelProfile(input, index);
  const { source } = parsed;
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
  const exporters = source.exporters.map((exporter, exporterIndex) =>
    resolveExporterSlot(
      exporter,
      `${profilePath}.exporters[${String(exporterIndex)}]`,
      capabilityById,
      runtimeBindingById
    )
  );
  const sortedExporters = sortBy(exporters, ({ exporterId }) => exporterId);
  const outputInvokers = source.outputInvokers.map((outputInvoker, outputInvokerIndex) =>
    resolveOutputInvokerSlot(
      outputInvoker,
      `${profilePath}.outputInvokers[${String(outputInvokerIndex)}]`,
      capabilityById,
      runtimeBindingById
    )
  );
  const sortedOutputInvokers = sortBy(outputInvokers, ({ outputInvokerId }) => outputInvokerId);
  const artifactHandoffSupports = collectArtifactHandoffSupports([
    ...sortedInitializers,
    ...sortedTrainers,
    ...sortedExporters,
    ...sortedOutputInvokers,
  ]);
  const evidence = parseJsonValue({
    profileId: source.profileId,
    initializers: sortedInitializers.map(initializerSlotEvidence),
    trainers: sortedTrainers.map(trainerSlotEvidence),
    exporters: sortedExporters.map(exporterSlotEvidence),
    outputInvokers: sortedOutputInvokers.map(outputInvokerSlotEvidence),
  });
  return Object.freeze({
    profileId: source.profileId,
    source,
    infrastructure: parsed.infrastructure,
    initializers: sortedInitializers,
    trainers: sortedTrainers,
    exporters: sortedExporters,
    outputInvokers: sortedOutputInvokers,
    artifactHandoffSupports,
    evidenceDigest: deriveEvidenceDigest(evidence),
  });
}

function collectArtifactHandoffSupports(
  slots: readonly (
    | ResolvedInitializerSlot
    | ResolvedTrainerSlot
    | ResolvedExporterSlot
    | ResolvedOutputInvokerSlot
  )[]
) {
  const byId = new Map(
    slots.map((slot) => [
      slot.runtime.supports.artifactHandoff.runtimeSupportId,
      slot.runtime.supports.artifactHandoff,
    ])
  );
  return sortBy([...byId.values()], ({ runtimeSupportId }) => runtimeSupportId);
}

function resolveInitializerSlot(
  source: ModelProfile['initializers'][number],
  path: string,
  capabilityById: ReadonlyMap<string, ModelCapabilityRuntime>,
  runtimeBindingById: ReadonlyMap<string, ResolvedRuntimeBinding>
): ResolvedInitializerSlot {
  const capability = requireCapability(
    capabilityById,
    source.capabilityId,
    ModelCapabilityKind.Initializer,
    `${path}.capabilityId`
  );
  const runtime = requireExecutionRuntimeBinding(runtimeBindingById, source.runtimeBindingId, path);
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
  capabilityById: ReadonlyMap<string, ModelCapabilityRuntime>,
  runtimeBindingById: ReadonlyMap<string, ResolvedRuntimeBinding>
): ResolvedTrainerSlot {
  const capability = requireCapability(
    capabilityById,
    source.capabilityId,
    ModelCapabilityKind.Trainer,
    `${path}.capabilityId`
  );
  const runtime = requireExecutionRuntimeBinding(runtimeBindingById, source.runtimeBindingId, path);
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

function resolveExporterSlot(
  source: ModelProfile['exporters'][number],
  path: string,
  capabilityById: ReadonlyMap<string, ModelCapabilityRuntime>,
  runtimeBindingById: ReadonlyMap<string, ResolvedRuntimeBinding>
): ResolvedExporterSlot {
  const capability = requireCapability(
    capabilityById,
    source.capabilityId,
    ModelCapabilityKind.Exporter,
    `${path}.capabilityId`
  );
  const runtime = requireExecutionRuntimeBinding(runtimeBindingById, source.runtimeBindingId, path);
  const evidence = parseJsonValue({
    exporterId: source.exporterId,
    capability: capabilityEvidence(capability),
    runtime: runtimeBindingEvidence(runtime),
  });
  return Object.freeze({
    exporterId: source.exporterId,
    capability,
    runtime,
    evidenceDigest: deriveEvidenceDigest(evidence),
  });
}

function resolveOutputInvokerSlot(
  source: ModelProfile['outputInvokers'][number],
  path: string,
  capabilityById: ReadonlyMap<string, ModelCapabilityRuntime>,
  runtimeBindingById: ReadonlyMap<string, ResolvedRuntimeBinding>
): ResolvedOutputInvokerSlot {
  const capability = requireCapability(
    capabilityById,
    source.capabilityId,
    ModelCapabilityKind.OutputInvoker,
    `${path}.capabilityId`
  );
  const runtime = requireRuntimeBinding(runtimeBindingById, source.runtimeBindingId, path);
  const evidence = parseJsonValue({
    outputInvokerId: source.outputInvokerId,
    capability: capabilityEvidence(capability),
    runtime: runtimeBindingEvidence(runtime),
  });
  return Object.freeze({
    outputInvokerId: source.outputInvokerId,
    capability,
    runtime,
    evidenceDigest: deriveEvidenceDigest(evidence),
  });
}

function requireCapability<TKind extends ModelCapabilityRuntime['kind']>(
  capabilityById: ReadonlyMap<string, ModelCapabilityRuntime>,
  capabilityId: string,
  expectedKind: TKind,
  path: string
): Extract<ModelCapabilityRuntime, { readonly kind: TKind }> {
  const capability = capabilityById.get(capabilityId);
  if (capability === undefined) {
    invalidSetup(path, `references unknown Capability "${capabilityId}"`);
  }
  if (capability.kind !== expectedKind) {
    invalidSetup(path, `must reference Model Capability kind "${expectedKind}"`);
  }
  return capability as Extract<ModelCapabilityRuntime, { readonly kind: TKind }>;
}

function requireRuntimeBinding(
  runtimeBindingById: ReadonlyMap<string, ResolvedRuntimeBinding>,
  runtimeBindingId: string,
  path: string
): ResolvedRuntimeBinding {
  const runtime = runtimeBindingById.get(runtimeBindingId);
  if (runtime === undefined) {
    invalidSetup(
      `${path}.runtimeBindingId`,
      `references unknown Runtime Binding "${runtimeBindingId}"`
    );
  }
  return runtime;
}

function requireExecutionRuntimeBinding(
  runtimeBindingById: ReadonlyMap<string, ResolvedRuntimeBinding>,
  runtimeBindingId: string,
  path: string
): ResolvedExecutionRuntimeBinding {
  const runtime = requireRuntimeBinding(runtimeBindingById, runtimeBindingId, path);
  if (runtime.supports.execution === undefined) {
    invalidSetup(
      `${path}.runtimeBindingId`,
      `references Runtime Binding "${runtimeBindingId}" without Execution Support`
    );
  }
  return runtime as ResolvedExecutionRuntimeBinding;
}
