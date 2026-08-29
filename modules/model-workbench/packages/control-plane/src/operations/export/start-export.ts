import {
  defineModelState,
  defineStartingExportRun,
  parseExporterId,
  parseProfileId,
  parseRunId,
} from '@ta-agent/workbench-domain';
import type { RunRepository } from '@ta-agent/workbench-persistence';
import {
  findResolvedExporter,
  findResolvedProfile,
  type ResolvedWorkbenchSetup,
} from '@ta-agent/workbench-setup';

import type { StartExportInput, StartExportResult } from './contracts.js';
import { ExporterSlotNotFoundError } from './errors.js';
import type { ExportExecutionHandler } from './export-execution-handler.js';
import {
  StartingRunResumeKind,
  type ModelWorkbenchOperationOptions,
} from '../../execution/contracts.js';
import { defineStartingRunResumeContext } from '../../execution/dispatch-model-run.js';
import type { WorkbenchIdSource } from '../../ports/workbench-id-source.js';
import { readWorkbenchClock, type WorkbenchClock } from '../../ports/workbench-clock.js';
import { ModelProfileNotFoundError } from '../errors.js';

export interface StartExportDependencies {
  readonly setup: ResolvedWorkbenchSetup;
  readonly runs: RunRepository;
  readonly handler: ExportExecutionHandler;
  readonly idSource: WorkbenchIdSource;
  readonly clock: WorkbenchClock;
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
    const profile = findResolvedProfile(dependencies.setup, profileId);
    if (profile === undefined) throw new ModelProfileNotFoundError(profileId);
    const exporter = findResolvedExporter(profile, exporterId);
    if (exporter === undefined) throw new ExporterSlotNotFoundError(profileId, exporterId);
    const operationInput = exporter.capability.contracts.input.parse(input.input, 'export.input');

    const runId = parseRunId(dependencies.idSource.nextId('run'), 'generated.runId');
    const starting = defineStartingExportRun({
      runId,
      profileId,
      exporterId,
      capabilityId: exporter.capability.capabilityId,
      runtimeBindingId: exporter.runtime.runtimeBindingId,
      slotEvidenceDigest: exporter.evidenceDigest,
      source,
      input: operationInput,
      createdAt: readWorkbenchClock(dependencies.clock, 'clock.createdAt'),
    });
    await dependencies.runs.create(starting);
    await dependencies.handler.resumeStarting(
      starting,
      defineStartingRunResumeContext(StartingRunResumeKind.InitialDispatch, options)
    );
    return Object.freeze({ runId });
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
