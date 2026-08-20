import {
  defineModelState,
  defineStartingExportRun,
  ModelOperationKind,
  parseExporterId,
  parseJsonValue,
  parseProfileId,
  parseRunId,
} from '@ta-agent/workbench-domain';
import type {
  CapabilityDispatch,
  ExportCapabilityResult,
  MaterializedModelState,
} from '@ta-agent/workbench-extension';
import type { RunRepository } from '@ta-agent/workbench-persistence';
import {
  findResolvedExporter,
  findResolvedProfile,
  type ResolvedWorkbenchSetup,
} from '@ta-agent/workbench-setup';

import type { StartExportInput, StartExportResult } from './contracts.js';
import { ExporterSlotNotFoundError } from './errors.js';
import type { ExportExecutionHandler } from './export-execution-handler.js';
import type {
  ExecutionLifecycle,
  ModelWorkbenchOperationOptions,
} from '../../execution/contracts.js';
import type { MaterializeModelState } from '../../model-states/materialize-model-state.js';
import type { WorkbenchIdSource } from '../../ports/workbench-id-source.js';
import { ModelProfileNotFoundError } from '../errors.js';

export interface StartExportDependencies {
  readonly setup: ResolvedWorkbenchSetup;
  readonly runs: RunRepository;
  readonly lifecycle: ExecutionLifecycle;
  readonly handler: ExportExecutionHandler;
  readonly materializeModelState: MaterializeModelState;
  readonly idSource: WorkbenchIdSource;
}

export function createStartExport(dependencies: StartExportDependencies) {
  return async function startExport(
    input: StartExportInput,
    options?: ModelWorkbenchOperationOptions
  ): Promise<StartExportResult> {
    assertNotAborted(options?.signal);
    const profileId = parseProfileId(input.profileId, 'export.profileId');
    const exporterId = parseExporterId(input.exporterId, 'export.exporterId');
    const source = defineModelState(input.source);
    const operationInput = parseJsonValue(input.input, 'export.input');
    const profile = findResolvedProfile(dependencies.setup, profileId);
    if (profile === undefined) throw new ModelProfileNotFoundError(profileId);
    const exporter = findResolvedExporter(profile, exporterId);
    if (exporter === undefined) throw new ExporterSlotNotFoundError(profileId, exporterId);

    const runId = parseRunId(dependencies.idSource.nextId('run'), 'generated.runId');
    const starting = defineStartingExportRun({
      runId,
      profileId,
      exporterId,
      capabilityId: exporter.capability.capabilityId,
      runtimeBindingId: exporter.runtime.runtimeBindingId,
      slotEvidenceDigest: exporter.evidenceDigest,
      source,
    });
    await dependencies.runs.create(starting);

    let materializedSource: MaterializedModelState;
    try {
      materializedSource = await dependencies.materializeModelState(
        Object.freeze({ runId, profileId, operation: ModelOperationKind.Export, state: source }),
        options
      );
    } catch (cause: unknown) {
      return dependencies.handler.rejectPreparation(starting, cause);
    }

    let dispatch: CapabilityDispatch<ExportCapabilityResult>;
    try {
      dispatch = await exporter.capability.export(
        Object.freeze({
          operation: ModelOperationKind.Export,
          profileId,
          runId,
          source: materializedSource,
          input: operationInput,
        }),
        options
      );
    } catch (cause: unknown) {
      return dependencies.handler.rejectInvocation(starting, cause);
    }

    try {
      await dependencies.lifecycle.acceptCapabilityDispatch(
        {
          run: starting,
          dispatch,
          complete: (terminal, completionOptions) =>
            dependencies.handler.complete(starting, exporter, terminal, completionOptions),
        },
        options
      );
      return Object.freeze({ runId });
    } catch (cause: unknown) {
      return dependencies.handler.rejectCompletion(starting, cause);
    }
  };
}

function assertNotAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted !== true) return;
  const error = new Error('Export was aborted before capability invocation.', {
    cause: signal.reason,
  });
  error.name = 'AbortError';
  throw error;
}
