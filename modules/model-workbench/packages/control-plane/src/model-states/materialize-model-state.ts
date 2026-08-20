import type {
  ArtifactReference,
  ModelBase,
  ModelModification,
  ModelOperationKind,
  ModelState,
  ProfileId,
  RunId,
} from '@ta-agent/workbench-domain';
import type {
  ArtifactMaterialization,
  ArtifactHandoffSupportRuntime,
  MaterializedModelState,
} from '@ta-agent/workbench-extension';
import type { ParameterRepository } from '@ta-agent/workbench-persistence';

import {
  ArtifactHandoffSupportNotFoundError,
  ModelStateArtifactMaterializationError,
  ModelStateAssetMismatchError,
  ModelStateAssetNotFoundError,
  ModelStateAssetProfileMismatchError,
} from './errors.js';
import type { ModelWorkbenchOperationOptions } from '../execution/contracts.js';

export interface MaterializeModelStateInput {
  readonly runId: RunId;
  readonly profileId: ProfileId;
  readonly operation: Extract<ModelOperationKind, 'training' | 'export'>;
  readonly state: ModelState;
}

export interface ModelStateMaterializerDependencies {
  readonly artifactHandoffSupports: readonly ArtifactHandoffSupportRuntime[];
  readonly parameters: ParameterRepository;
}

export type MaterializeModelState = (
  input: MaterializeModelStateInput,
  options?: ModelWorkbenchOperationOptions
) => Promise<MaterializedModelState>;

export function createModelStateMaterializer(
  dependencies: ModelStateMaterializerDependencies
): MaterializeModelState {
  return async (input, options) => {
    const [base, modifications] = await Promise.all([
      requireBase(dependencies.parameters, input),
      Promise.all(
        input.state.modificationIds.map((modificationId) =>
          requireModification(dependencies.parameters, input, modificationId)
        )
      ),
    ]);
    const [materializedBase, materializedModifications] = await Promise.all([
      materializeArtifact(dependencies.artifactHandoffSupports, input, base.artifact, options),
      Promise.all(
        modifications.map(async (modification) =>
          Object.freeze({
            modificationId: modification.modificationId,
            artifact: await materializeArtifact(
              dependencies.artifactHandoffSupports,
              input,
              modification.artifact,
              options
            ),
          })
        )
      ),
    ]);

    return Object.freeze({
      state: input.state,
      base: Object.freeze({ baseId: base.baseId, artifact: materializedBase }),
      modifications: Object.freeze(materializedModifications),
    });
  };
}

async function requireBase(
  parameters: ParameterRepository,
  input: MaterializeModelStateInput
): Promise<ModelBase> {
  const base = await parameters.findBase(input.state.baseId);
  if (base === undefined) {
    throw new ModelStateAssetNotFoundError(
      input.runId,
      input.operation,
      'base',
      input.state.baseId
    );
  }
  if (base.baseId !== input.state.baseId) {
    throw new ModelStateAssetMismatchError(
      input.runId,
      input.operation,
      'base',
      input.state.baseId,
      base.baseId
    );
  }
  if (base.profileId !== input.profileId) {
    throw new ModelStateAssetProfileMismatchError(
      input.runId,
      input.operation,
      'base',
      base.baseId,
      input.profileId,
      base.profileId
    );
  }
  return base;
}

async function requireModification(
  parameters: ParameterRepository,
  input: MaterializeModelStateInput,
  modificationId: ModelState['modificationIds'][number]
): Promise<ModelModification> {
  const modification = await parameters.findModification(modificationId);
  if (modification === undefined) {
    throw new ModelStateAssetNotFoundError(
      input.runId,
      input.operation,
      'modification',
      modificationId
    );
  }
  if (modification.modificationId !== modificationId) {
    throw new ModelStateAssetMismatchError(
      input.runId,
      input.operation,
      'modification',
      modificationId,
      modification.modificationId
    );
  }
  if (modification.profileId !== input.profileId) {
    throw new ModelStateAssetProfileMismatchError(
      input.runId,
      input.operation,
      'modification',
      modification.modificationId,
      input.profileId,
      modification.profileId
    );
  }
  return modification;
}

async function materializeArtifact(
  artifactHandoffSupports: readonly ArtifactHandoffSupportRuntime[],
  input: MaterializeModelStateInput,
  artifact: ArtifactReference,
  options?: ModelWorkbenchOperationOptions
): Promise<ArtifactMaterialization> {
  const support = artifactHandoffSupports.find(
    ({ runtimeSupportId }) => runtimeSupportId === artifact.handoff.runtimeSupportId
  );
  if (support === undefined) {
    throw new ArtifactHandoffSupportNotFoundError(
      input.runId,
      input.operation,
      artifact.handoff.runtimeSupportId
    );
  }
  try {
    await support.verify(Object.freeze({ profileId: input.profileId, artifact }), options);
    return await support.materialize(
      Object.freeze({ profileId: input.profileId, artifact }),
      options
    );
  } catch (cause: unknown) {
    if (isAbortError(cause)) throw cause;
    throw new ModelStateArtifactMaterializationError(
      input.runId,
      input.operation,
      artifact.artifactId,
      { cause }
    );
  }
}

function isAbortError(cause: unknown): boolean {
  return cause instanceof Error && cause.name === 'AbortError';
}
