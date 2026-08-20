import {
  defineModelState,
  parseBaseId,
  parseModificationId,
  parseOutputId,
  parseProfileId,
  type ProfileId,
} from '@ta-agent/workbench-domain';
import { findResolvedProfile } from '@ta-agent/workbench-setup';

import type {
  ModelWorkbenchControlPlane,
  WorkbenchControlPlaneConfiguration,
} from './contracts.js';
import {
  createProfileControlPlaneRuntime,
  type ProfileControlPlaneRuntime,
} from './create-profile-control-plane-runtime.js';
import type { ModelWorkbenchOperationOptions } from '../execution/contracts.js';
import type { StartExportInput } from '../operations/export/contracts.js';
import { ModelProfileNotFoundError } from '../operations/errors.js';
import type { StartInitializationInput } from '../operations/initialization/contracts.js';
import type { InvokeOutputInput } from '../operations/output-invocation/contracts.js';
import type { StartTrainingInput } from '../operations/training/contracts.js';
import type {
  BaseReferenceInput,
  ModificationReferenceInput,
  OutputReferenceInput,
  RunReferenceInput,
  WaitForRunOptions,
} from '../queries/contracts.js';

export function createWorkbenchControlPlane(
  configuration: WorkbenchControlPlaneConfiguration
): ModelWorkbenchControlPlane {
  const runtimeByProfile = new Map<ProfileId, Promise<ProfileControlPlaneRuntime>>();

  async function forProfile(
    inputProfileId: string,
    path: string
  ): Promise<ProfileControlPlaneRuntime> {
    const profileId = parseProfileId(inputProfileId, path);
    const profile = findResolvedProfile(configuration.setup, profileId);
    if (profile === undefined) throw new ModelProfileNotFoundError(profileId);

    const existing = runtimeByProfile.get(profileId);
    if (existing !== undefined) return existing;

    const pending = configuration.persistence
      .forProfile(
        Object.freeze({
          profileId,
          ...(profile.infrastructure.persistence.configuration === undefined
            ? {}
            : { configuration: profile.infrastructure.persistence.configuration }),
        })
      )
      .then((persistence) => createProfileControlPlaneRuntime(configuration, profile, persistence));
    runtimeByProfile.set(profileId, pending);
    try {
      return await pending;
    } catch (error: unknown) {
      if (runtimeByProfile.get(profileId) === pending) runtimeByProfile.delete(profileId);
      throw error;
    }
  }

  return Object.freeze({
    setup: Object.freeze({ evidenceDigest: configuration.setup.evidenceDigest }),
    initialization: Object.freeze({
      start: async (input: StartInitializationInput, options?: ModelWorkbenchOperationOptions) =>
        (await forProfile(input.profileId, 'initialization.profileId')).startInitialization(
          input,
          options
        ),
    }),
    training: Object.freeze({
      start: async (input: StartTrainingInput, options?: ModelWorkbenchOperationOptions) =>
        (await forProfile(input.profileId, 'training.profileId')).startTraining(input, options),
    }),
    exports: Object.freeze({
      start: async (input: StartExportInput, options?: ModelWorkbenchOperationOptions) =>
        (await forProfile(input.profileId, 'export.profileId')).startExport(input, options),
    }),
    outputInvocations: Object.freeze({
      invoke: async (input: InvokeOutputInput, options?: ModelWorkbenchOperationOptions) =>
        (await forProfile(input.profileId, 'outputInvocation.profileId')).invokeOutput(
          input,
          options
        ),
    }),
    runs: Object.freeze({
      get: async ({ profileId, runId }: RunReferenceInput) =>
        (await forProfile(profileId, 'run.profileId')).lifecycle.runs.get(runId),
      refresh: async (
        { profileId, runId }: RunReferenceInput,
        options?: ModelWorkbenchOperationOptions
      ) => (await forProfile(profileId, 'run.profileId')).lifecycle.runs.refresh(runId, options),
      wait: async ({ profileId, runId }: RunReferenceInput, options?: WaitForRunOptions) =>
        (await forProfile(profileId, 'run.profileId')).lifecycle.runs.wait(runId, options),
      cancel: async (
        { profileId, runId }: RunReferenceInput,
        options?: ModelWorkbenchOperationOptions
      ) => (await forProfile(profileId, 'run.profileId')).lifecycle.runs.cancel(runId, options),
    }),
    models: Object.freeze({
      compose: defineModelState,
      getBase: async ({ profileId, baseId }: BaseReferenceInput) => {
        const runtime = await forProfile(profileId, 'base.profileId');
        const requestedBaseId = parseBaseId(baseId, 'baseId');
        const base = await runtime.persistence.parameters.findBase(requestedBaseId);
        return base?.profileId === runtime.profile.profileId && base.baseId === requestedBaseId
          ? base
          : undefined;
      },
      getModification: async ({ profileId, modificationId }: ModificationReferenceInput) => {
        const runtime = await forProfile(profileId, 'modification.profileId');
        const requestedModificationId = parseModificationId(modificationId, 'modificationId');
        const modification =
          await runtime.persistence.parameters.findModification(requestedModificationId);
        return modification?.profileId === runtime.profile.profileId &&
          modification.modificationId === requestedModificationId
          ? modification
          : undefined;
      },
    }),
    outputs: Object.freeze({
      get: async ({ profileId, outputId }: OutputReferenceInput) => {
        const runtime = await forProfile(profileId, 'output.profileId');
        const requestedOutputId = parseOutputId(outputId, 'outputId');
        const output = await runtime.persistence.outputs.findOutput(requestedOutputId);
        return output?.profileId === runtime.profile.profileId &&
          output.outputId === requestedOutputId
          ? output
          : undefined;
      },
    }),
  });
}
