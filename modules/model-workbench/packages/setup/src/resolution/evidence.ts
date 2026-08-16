import { parseJsonValue, type JsonValue } from '@ta-agent/workbench-domain';
import type {
  ArtifactVerifierSupportRuntime,
  InitializerCapabilityRuntime,
} from '@ta-agent/workbench-extension';

import type { ResolvedInitializerSlot, ResolvedModelProfile } from '../profiles/contracts.js';
import type { ResolvedRuntimeBinding } from '../runtime-bindings/contracts.js';

export function capabilityEvidence(capability: InitializerCapabilityRuntime): JsonValue {
  return parseJsonValue({
    family: capability.family,
    kind: capability.kind,
    capabilityId: capability.capabilityId,
    contracts: {
      input: capability.contracts.input.evidence,
      ...(capability.contracts.resultData === undefined
        ? {}
        : { resultData: capability.contracts.resultData.evidence }),
    },
    evidenceDigest: capability.evidenceDigest,
    ...(capability.metadata === undefined ? {} : { metadata: capability.metadata }),
  });
}

export function runtimeSupportEvidence(support: ArtifactVerifierSupportRuntime): JsonValue {
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
      artifactVerifier: runtimeSupportEvidence(binding.supports.artifactVerifier),
    },
    evidenceDigest: binding.evidenceDigest,
    ...(binding.metadata === undefined ? {} : { metadata: binding.metadata }),
  });
}

export function slotEvidence(slot: ResolvedInitializerSlot): JsonValue {
  return parseJsonValue({
    initializerId: slot.initializerId,
    capability: capabilityEvidence(slot.capability),
    runtime: runtimeBindingEvidence(slot.runtime),
    evidenceDigest: slot.evidenceDigest,
  });
}

export function profileEvidence(profile: ResolvedModelProfile): JsonValue {
  return parseJsonValue({
    profileId: profile.profileId,
    initializers: profile.initializers.map(slotEvidence),
    evidenceDigest: profile.evidenceDigest,
  });
}
