import { deriveEvidenceDigest, parseJsonValue } from '@ta-agent/workbench-domain';

import { WorkbenchSetupKind } from '../foundation/constants.js';
import { assertUnique, parseArray, parseClosedRecord, sortBy } from '../foundation/parsing.js';
import type { ResolvedInitializerSlot, ResolvedModelProfile } from '../profiles/contracts.js';
import { resolveModelProfile } from '../profiles/resolve-model-profile.js';
import { indexExtensionResources } from '../resources/index-extension-resources.js';
import { resolveRuntimeBinding } from '../runtime-bindings/resolve-runtime-binding.js';
import type { ResolvedWorkbenchSetup, WorkbenchExtensionResources } from './contracts.js';
import { profileEvidence } from './evidence.js';

export function resolveWorkbenchSetup(
  input: unknown,
  resources: WorkbenchExtensionResources
): ResolvedWorkbenchSetup {
  const indexedResources = indexExtensionResources(resources);
  const record = parseClosedRecord(input, 'setup', ['runtimeBindings', 'profiles']);
  const runtimeBindings = parseArray(record.runtimeBindings, 'setup.runtimeBindings').map(
    (binding, index) => resolveRuntimeBinding(binding, index, indexedResources.supportById)
  );
  assertUnique(
    runtimeBindings,
    ({ runtimeBindingId }) => runtimeBindingId,
    'setup.runtimeBindings'
  );
  const runtimeBindingById = new Map(
    runtimeBindings.map((binding) => [binding.runtimeBindingId, binding])
  );
  const profiles = parseArray(record.profiles, 'setup.profiles').map((profile, index) =>
    resolveModelProfile(profile, index, indexedResources.capabilityById, runtimeBindingById)
  );
  assertUnique(profiles, ({ profileId }) => profileId, 'setup.profiles');

  const sortedProfiles = sortBy(profiles, ({ profileId }) => profileId);
  const evidence = parseJsonValue({ profiles: sortedProfiles.map(profileEvidence) });
  return Object.freeze({
    kind: WorkbenchSetupKind.Resolved,
    profiles: sortedProfiles,
    evidenceDigest: deriveEvidenceDigest(evidence),
  });
}

export function findResolvedProfile(
  setup: ResolvedWorkbenchSetup,
  profileId: string
): ResolvedModelProfile | undefined {
  return setup.profiles.find((profile) => profile.profileId === profileId);
}

export function findResolvedInitializer(
  profile: ResolvedModelProfile,
  initializerId: string
): ResolvedInitializerSlot | undefined {
  return profile.initializers.find((initializer) => initializer.initializerId === initializerId);
}
