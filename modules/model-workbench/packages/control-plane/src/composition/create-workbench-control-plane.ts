import {
  defineModelState,
  parseBaseId,
  parseModificationId,
  parseRunId,
  parseOutputId,
  parseProfileId,
  parseTimestamp,
  ModelOperationKind,
  ModelRunStatus,
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
import { WorkbenchControlPlaneError } from '../foundation/errors.js';
import type { StartExportInput } from '../operations/export/contracts.js';
import { ModelProfileNotFoundError } from '../operations/errors.js';
import type { StartInitializationInput } from '../operations/initialization/contracts.js';
import type { InvokeOutputInput } from '../operations/output-invocation/contracts.js';
import type { StartTrainingInput } from '../operations/training/contracts.js';
import type {
  BaseReferenceInput,
  ListModelAssetsInput,
  ListOutputsInput,
  ListRunsInput,
  ModificationReferenceInput,
  OutputReferenceInput,
  RunReferenceInput,
  WaitForRunOptions,
} from '../queries/contracts.js';
import { listMatchingRecords } from '../queries/list-records.js';

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
      list: async (input: ListRunsInput) => {
        const runtime = await forProfile(input.profileId, 'runs.profileId');
        const operation = parseOptionalEnum(
          input.operation,
          Object.values(ModelOperationKind),
          'runs.operation'
        );
        const status = parseOptionalEnum(
          input.status,
          Object.values(ModelRunStatus),
          'runs.status'
        );
        const createdAfter = parseOptionalTimestamp(input.createdAfter, 'runs.createdAfter');
        const createdBefore = parseOptionalTimestamp(input.createdBefore, 'runs.createdBefore');
        if (
          createdAfter !== undefined &&
          createdBefore !== undefined &&
          createdAfter > createdBefore
        ) {
          invalidDiscoveryFilter('runs.createdAfter must not be later than runs.createdBefore.');
        }
        return listMatchingRecords({
          ...(input.cursor === undefined ? {} : { after: parseRunId(input.cursor, 'runs.cursor') }),
          ...(input.limit === undefined ? {} : { limit: input.limit }),
          load: (request) => runtime.persistence.runs.list(request),
          identity: (run) => run.runId,
          validate: (run) => assertDiscoveryProfile(runtime.profile.profileId, run.profileId),
          matches: (run) =>
            (operation === undefined || run.operation === operation) &&
            (status === undefined || run.status === status) &&
            (createdAfter === undefined || run.createdAt >= createdAfter) &&
            (createdBefore === undefined || run.createdAt <= createdBefore),
        });
      },
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
      listBases: async (input: ListModelAssetsInput) => {
        const runtime = await forProfile(input.profileId, 'bases.profileId');
        return listMatchingRecords({
          ...(input.cursor === undefined
            ? {}
            : { after: parseBaseId(input.cursor, 'bases.cursor') }),
          ...(input.limit === undefined ? {} : { limit: input.limit }),
          load: (request) => runtime.persistence.parameters.listBases(request),
          identity: (base) => base.baseId,
          validate: (base) => assertDiscoveryProfile(runtime.profile.profileId, base.profileId),
        });
      },
      listModifications: async (input: ListModelAssetsInput) => {
        const runtime = await forProfile(input.profileId, 'modifications.profileId');
        return listMatchingRecords({
          ...(input.cursor === undefined
            ? {}
            : { after: parseModificationId(input.cursor, 'modifications.cursor') }),
          ...(input.limit === undefined ? {} : { limit: input.limit }),
          load: (request) => runtime.persistence.parameters.listModifications(request),
          identity: (modification) => modification.modificationId,
          validate: (modification) =>
            assertDiscoveryProfile(runtime.profile.profileId, modification.profileId),
        });
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
      list: async (input: ListOutputsInput) => {
        const runtime = await forProfile(input.profileId, 'outputs.profileId');
        return listMatchingRecords({
          ...(input.cursor === undefined
            ? {}
            : { after: parseOutputId(input.cursor, 'outputs.cursor') }),
          ...(input.limit === undefined ? {} : { limit: input.limit }),
          load: (request) => runtime.persistence.outputs.listOutputs(request),
          identity: (output) => output.outputId,
          validate: (output) => assertDiscoveryProfile(runtime.profile.profileId, output.profileId),
        });
      },
    }),
  });
}

function parseOptionalTimestamp(input: string | undefined, path: string) {
  return input === undefined ? undefined : parseTimestamp(input, path);
}

function parseOptionalEnum<TValue extends string>(
  input: TValue | undefined,
  values: readonly TValue[],
  path: string
): TValue | undefined {
  if (input === undefined) return undefined;
  if (!values.includes(input)) {
    invalidDiscoveryFilter(`${path} is not a supported value.`);
  }
  return input;
}

function assertDiscoveryProfile(expectedProfileId: string, actualProfileId: string): void {
  if (expectedProfileId !== actualProfileId) {
    throw new WorkbenchControlPlaneError(
      'DISCOVERY_RECORD_MISMATCH',
      `Persistence returned a record outside Profile "${expectedProfileId}".`
    );
  }
}

function invalidDiscoveryFilter(message: string): never {
  throw new WorkbenchControlPlaneError('DISCOVERY_FILTER_INVALID', message);
}
