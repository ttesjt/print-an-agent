import { type ModelOutput, type ProfileId } from '@ta-agent/workbench-domain';
import type {
  MaterializedModelOutput,
  MaterializedOutputArtifact,
} from '@ta-agent/workbench-extension';
import {
  findProfileArtifactHandoffSupport,
  type ResolvedModelProfile,
} from '@ta-agent/workbench-setup';

import { OutputInvocationArtifactMaterializationError } from './errors.js';
import type { ModelWorkbenchOperationOptions } from '../../execution/contracts.js';

export interface MaterializeOutputInput {
  readonly profileId: ProfileId;
  readonly output: ModelOutput;
}

export type MaterializeOutput = (
  input: MaterializeOutputInput,
  options?: ModelWorkbenchOperationOptions
) => Promise<MaterializedModelOutput>;

export function createOutputMaterializer(profile: ResolvedModelProfile): MaterializeOutput {
  return async (input, options) => {
    const artifacts = await Promise.all(
      input.output.artifacts.map(
        async ({ name, artifact }): Promise<MaterializedOutputArtifact> => {
          const support = findProfileArtifactHandoffSupport(
            profile,
            artifact.handoff.runtimeSupportId
          );
          if (support === undefined) {
            throw new OutputInvocationArtifactMaterializationError(
              input.output.outputId,
              artifact.artifactId,
              {
                cause: new Error(
                  `Runtime Support "${artifact.handoff.runtimeSupportId}" is not available to this Profile.`
                ),
              }
            );
          }
          try {
            await support.verify(Object.freeze({ profileId: input.profileId, artifact }), options);
            return Object.freeze({
              name,
              artifact: await support.materialize(
                Object.freeze({ profileId: input.profileId, artifact }),
                options
              ),
            });
          } catch (cause: unknown) {
            if (isAbortError(cause)) throw cause;
            throw new OutputInvocationArtifactMaterializationError(
              input.output.outputId,
              artifact.artifactId,
              { cause }
            );
          }
        }
      )
    );
    return Object.freeze({ output: input.output, artifacts: Object.freeze(artifacts) });
  };
}

function isAbortError(cause: unknown): boolean {
  return cause instanceof Error && cause.name === 'AbortError';
}
