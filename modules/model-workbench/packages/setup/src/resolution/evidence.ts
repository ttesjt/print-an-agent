import { parseJsonValue, type JsonValue } from '@print-an-agent/workbench-domain';
import type {
  ArtifactHandoffSupportRuntime,
  ExecutionSupportRuntime,
  ModelCapabilityRuntime,
} from '@print-an-agent/workbench-extension';

import type {
  ResolvedInitializerSlot,
  ResolvedModelProfile,
  ResolvedExporterSlot,
  ResolvedOutputInvokerSlot,
  ResolvedTrainerSlot,
} from '../profiles/contracts.js';
import type { ResolvedRuntimeBinding } from '../runtime-bindings/contracts.js';

export function capabilityEvidence(capability: ModelCapabilityRuntime): JsonValue {
  return parseJsonValue({
    family: capability.family,
    kind: capability.kind,
    capabilityId: capability.capabilityId,
    contracts: capabilityContractsEvidence(capability),
    evidenceDigest: capability.evidenceDigest,
    ...(capability.metadata === undefined ? {} : { metadata: capability.metadata }),
  });
}

function capabilityContractsEvidence(capability: ModelCapabilityRuntime): JsonValue {
  if ('output' in capability.contracts) {
    return parseJsonValue({
      input: capability.contracts.input.evidence,
      output: capability.contracts.output.evidence,
    });
  }
  return parseJsonValue({
    input: capability.contracts.input.evidence,
    ...(capability.contracts.resultData === undefined
      ? {}
      : { resultData: capability.contracts.resultData.evidence }),
  });
}

export function runtimeSupportEvidence(
  support: ArtifactHandoffSupportRuntime | ExecutionSupportRuntime
): JsonValue {
  return parseJsonValue({
    family: support.family,
    kind: support.kind,
    runtimeSupportId: support.runtimeSupportId,
    evidenceDigest: support.evidenceDigest,
    ...(support.metadata === undefined ? {} : { metadata: support.metadata }),
  });
}

export function runtimeBindingEvidence(binding: ResolvedRuntimeBinding): JsonValue {
  return parseJsonValue({
    kind: binding.kind,
    runtimeBindingId: binding.runtimeBindingId,
    supports: {
      artifactHandoff: runtimeSupportEvidence(binding.supports.artifactHandoff),
      ...(binding.supports.execution === undefined
        ? {}
        : { execution: runtimeSupportEvidence(binding.supports.execution) }),
    },
    evidenceDigest: binding.evidenceDigest,
    ...(binding.metadata === undefined ? {} : { metadata: binding.metadata }),
  });
}

export function initializerSlotEvidence(slot: ResolvedInitializerSlot): JsonValue {
  return parseJsonValue({
    initializerId: slot.initializerId,
    capability: capabilityEvidence(slot.capability),
    runtime: runtimeBindingEvidence(slot.runtime),
    evidenceDigest: slot.evidenceDigest,
  });
}

export function trainerSlotEvidence(slot: ResolvedTrainerSlot): JsonValue {
  return parseJsonValue({
    trainerId: slot.trainerId,
    capability: capabilityEvidence(slot.capability),
    runtime: runtimeBindingEvidence(slot.runtime),
    evidenceDigest: slot.evidenceDigest,
  });
}

export function exporterSlotEvidence(slot: ResolvedExporterSlot): JsonValue {
  return parseJsonValue({
    exporterId: slot.exporterId,
    capability: capabilityEvidence(slot.capability),
    runtime: runtimeBindingEvidence(slot.runtime),
    evidenceDigest: slot.evidenceDigest,
  });
}

export function outputInvokerSlotEvidence(slot: ResolvedOutputInvokerSlot): JsonValue {
  return parseJsonValue({
    outputInvokerId: slot.outputInvokerId,
    capability: capabilityEvidence(slot.capability),
    runtime: runtimeBindingEvidence(slot.runtime),
    evidenceDigest: slot.evidenceDigest,
  });
}

export function profileEvidence(profile: ResolvedModelProfile): JsonValue {
  return parseJsonValue({
    profileId: profile.profileId,
    initializers: profile.initializers.map(initializerSlotEvidence),
    trainers: profile.trainers.map(trainerSlotEvidence),
    exporters: profile.exporters.map(exporterSlotEvidence),
    outputInvokers: profile.outputInvokers.map(outputInvokerSlotEvidence),
    ...(profile.canonicalOutputInvoker === undefined
      ? {}
      : { canonicalOutputInvokerId: profile.canonicalOutputInvoker.outputInvokerId }),
    evidenceDigest: profile.evidenceDigest,
  });
}
