import type { BaseId, ModelState, ModificationId } from '@ta-agent/workbench-domain';

import type { ArtifactMaterialization } from '../../runtime-supports/artifact-handoff/contracts.js';

export interface MaterializedBaseParameter {
  readonly baseId: BaseId;
  readonly artifact: ArtifactMaterialization;
}

export interface MaterializedModificationParameter {
  readonly modificationId: ModificationId;
  readonly artifact: ArtifactMaterialization;
}

/** Exact Model State identity plus transient Artifact inputs prepared for one capability call. */
export interface MaterializedModelState {
  readonly state: ModelState;
  readonly base: MaterializedBaseParameter;
  readonly modifications: readonly MaterializedModificationParameter[];
}
