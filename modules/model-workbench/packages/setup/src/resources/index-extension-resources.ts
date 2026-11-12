import {
  type ModelCapabilityRuntime,
  type ArtifactHandoffSupportRuntime,
  type ExecutionSupportRuntime,
} from '@print-an-agent/workbench-extension';

import { assertUnique } from '../foundation/parsing.js';
import type { WorkbenchExtensionResources } from '../resolution/contracts.js';

export interface IndexedExtensionResources {
  readonly capabilityById: ReadonlyMap<string, ModelCapabilityRuntime>;
  readonly supportById: ReadonlyMap<
    string,
    ArtifactHandoffSupportRuntime | ExecutionSupportRuntime
  >;
}

export function indexExtensionResources(
  resources: WorkbenchExtensionResources
): IndexedExtensionResources {
  assertUnique(
    resources.modelCapabilities,
    ({ capabilityId }) => capabilityId,
    'resources.modelCapabilities'
  );
  assertUnique(
    resources.runtimeSupports,
    ({ runtimeSupportId }) => runtimeSupportId,
    'resources.runtimeSupports'
  );

  return Object.freeze({
    capabilityById: new Map(
      resources.modelCapabilities.map((capability) => [capability.capabilityId, capability])
    ),
    supportById: new Map(
      resources.runtimeSupports.map((support) => [support.runtimeSupportId, support])
    ),
  });
}
