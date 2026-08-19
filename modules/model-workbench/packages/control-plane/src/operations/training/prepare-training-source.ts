import type {
  ArtifactReference,
  ModelBase,
  ModelModification,
  ModelState,
  RunId,
} from '@ta-agent/workbench-domain';
import type {
  ArtifactMaterialization,
  MaterializedModelState,
} from '@ta-agent/workbench-extension';
import { findArtifactHandoffSupport, type ResolvedWorkbenchSetup } from '@ta-agent/workbench-setup';
import type { ParameterRepository } from '@ta-agent/workbench-persistence';

import type { ModelWorkbenchOperationOptions } from '../../execution/contracts.js';
import {
  ArtifactHandoffSupportNotFoundError,
  TrainingSourceAssetMismatchError,
  TrainingSourceAssetNotFoundError,
  TrainingSourcePreparationError,
} from './errors.js';

export interface PrepareTrainingSourceDependencies {
  readonly setup: ResolvedWorkbenchSetup;
  readonly parameters: ParameterRepository;
}

export type PrepareTrainingSource = (
  runId: RunId,
  state: ModelState,
  options?: ModelWorkbenchOperationOptions
) => Promise<MaterializedModelState>;

export function createPrepareTrainingSource(
  dependencies: PrepareTrainingSourceDependencies
): PrepareTrainingSource {
  return async (runId, state, options) => {
    const [base, modifications] = await Promise.all([
      requireBase(dependencies.parameters, runId, state),
      Promise.all(
        state.modificationIds.map((modificationId) =>
          requireModification(dependencies.parameters, runId, modificationId)
        )
      ),
    ]);
    const [materializedBase, materializedModifications] = await Promise.all([
      materializeArtifact(dependencies.setup, runId, base.artifact, options),
      Promise.all(
        modifications.map(async (modification) =>
          Object.freeze({
            modificationId: modification.modificationId,
            artifact: await materializeArtifact(
              dependencies.setup,
              runId,
              modification.artifact,
              options
            ),
          })
        )
      ),
    ]);

    return Object.freeze({
      state,
      base: Object.freeze({ baseId: base.baseId, artifact: materializedBase }),
      modifications: Object.freeze(materializedModifications),
    });
  };
}

async function requireBase(
  parameters: ParameterRepository,
  runId: RunId,
  state: ModelState
): Promise<ModelBase> {
  const base = await parameters.findBase(state.baseId);
  if (base === undefined) {
    throw new TrainingSourceAssetNotFoundError(runId, 'base', state.baseId);
  }
  if (base.baseId !== state.baseId) {
    throw new TrainingSourceAssetMismatchError(runId, 'base', state.baseId, base.baseId);
  }
  return base;
}

async function requireModification(
  parameters: ParameterRepository,
  runId: RunId,
  modificationId: ModelState['modificationIds'][number]
): Promise<ModelModification> {
  const modification = await parameters.findModification(modificationId);
  if (modification === undefined) {
    throw new TrainingSourceAssetNotFoundError(runId, 'modification', modificationId);
  }
  if (modification.modificationId !== modificationId) {
    throw new TrainingSourceAssetMismatchError(
      runId,
      'modification',
      modificationId,
      modification.modificationId
    );
  }
  return modification;
}

async function materializeArtifact(
  setup: ResolvedWorkbenchSetup,
  runId: RunId,
  artifact: ArtifactReference,
  options?: ModelWorkbenchOperationOptions
): Promise<ArtifactMaterialization> {
  const support = findArtifactHandoffSupport(setup, artifact.handoff.runtimeSupportId);
  if (support === undefined) {
    throw new ArtifactHandoffSupportNotFoundError(runId, artifact.handoff.runtimeSupportId);
  }
  try {
    await support.verify(Object.freeze({ artifact }), options);
    return await support.materialize(Object.freeze({ artifact }), options);
  } catch (cause: unknown) {
    if (isAbortError(cause)) throw cause;
    throw new TrainingSourcePreparationError(runId, artifact.artifactId, { cause });
  }
}

function isAbortError(cause: unknown): boolean {
  return cause instanceof Error && cause.name === 'AbortError';
}
