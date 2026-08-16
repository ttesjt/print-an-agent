import {
  deriveEvidenceDigest,
  parseJsonValue,
  type ModelProfile,
} from '@ta-agent/workbench-domain';
import type { InitializerCapabilityRuntime } from '@ta-agent/workbench-extension';

import { invalidSetup, sortBy } from '../foundation/parsing.js';
import {
  capabilityEvidence,
  runtimeBindingEvidence,
  slotEvidence,
} from '../resolution/evidence.js';
import type { ResolvedRuntimeBinding } from '../runtime-bindings/contracts.js';
import type { ResolvedInitializerSlot, ResolvedModelProfile } from './contracts.js';
import { parseModelProfile } from './parse-model-profile.js';

export function resolveModelProfile(
  input: unknown,
  index: number,
  capabilityById: ReadonlyMap<string, InitializerCapabilityRuntime>,
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
  const evidence = parseJsonValue({
    profileId: source.profileId,
    initializers: sortedInitializers.map(slotEvidence),
  });
  return Object.freeze({
    profileId: source.profileId,
    source,
    initializers: sortedInitializers,
    evidenceDigest: deriveEvidenceDigest(evidence),
  });
}

function resolveInitializerSlot(
  source: ModelProfile['initializers'][number],
  path: string,
  capabilityById: ReadonlyMap<string, InitializerCapabilityRuntime>,
  runtimeBindingById: ReadonlyMap<string, ResolvedRuntimeBinding>
): ResolvedInitializerSlot {
  const capability = capabilityById.get(source.capabilityId);
  if (capability === undefined) {
    invalidSetup(`${path}.capabilityId`, `references unknown Capability "${source.capabilityId}"`);
  }
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
