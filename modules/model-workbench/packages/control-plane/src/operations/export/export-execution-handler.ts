import {
  InvalidWorkbenchValueError,
  ModelOperationKind,
  ModelRunStatus,
  parseExecutionFailure,
  type ActiveExportRun,
  type ActiveModelRun,
  type ExecutionFailure,
  type JsonValue,
  type RunningExportRun,
  type RunningModelRun,
  type StartingExportRun,
  type StartingModelRun,
  type TerminalExportRun,
} from '@print-an-agent/workbench-domain';
import {
  ExecutionStatus,
  WorkbenchExtensionError,
  type ExecutionSupportRuntime,
  type ExecutionTerminal,
  type ExportCapabilityResult,
} from '@print-an-agent/workbench-extension';
import {
  WorkbenchPersistenceError,
  type ExportCommitter,
  type RunRepository,
} from '@print-an-agent/workbench-persistence';
import {
  findResolvedExporter,
  findResolvedProfile,
  type ResolvedExporterSlot,
  type ResolvedWorkbenchSetup,
} from '@print-an-agent/workbench-setup';

import { completeExport, recordExportFailure } from './complete-export.js';
import { ExportArtifactVerificationError, ExportCapabilityError } from './errors.js';
import type {
  ModelWorkbenchOperationOptions,
  OperationExecutionHandler,
  StartingRunResumeContext,
} from '../../execution/contracts.js';
import {
  acceptCapabilityDispatch,
  recordModelRunDispatch,
  recoveryAbortPreservesStartingRun,
} from '../../execution/dispatch-model-run.js';
import { RunExecutionSupportMismatchError } from '../../execution/errors.js';
import type { MaterializeModelState } from '../../model-states/materialize-model-state.js';
import type { WorkbenchClock } from '../../ports/workbench-clock.js';
import type { WorkbenchIdSource } from '../../ports/workbench-id-source.js';

export interface ExportExecutionHandler extends OperationExecutionHandler {
  readonly operation: typeof ModelOperationKind.Export;
  complete(
    run: ActiveExportRun,
    exporter: ResolvedExporterSlot,
    terminal: ExecutionTerminal<ExportCapabilityResult>,
    options?: ModelWorkbenchOperationOptions
  ): Promise<TerminalExportRun>;
  rejectPreparation(run: ActiveExportRun, cause: unknown): Promise<never>;
  rejectInvocation(run: ActiveExportRun, cause: unknown): Promise<never>;
  rejectCompletion(run: ActiveExportRun, cause: unknown): Promise<never>;
}

export interface ExportExecutionHandlerDependencies {
  readonly setup: ResolvedWorkbenchSetup;
  readonly exportCommitter: ExportCommitter;
  readonly runs: RunRepository;
  readonly materializeModelState: MaterializeModelState;
  readonly idSource: WorkbenchIdSource;
  readonly clock: WorkbenchClock;
}

export function createExportExecutionHandler(
  dependencies: ExportExecutionHandlerDependencies
): ExportExecutionHandler {
  return Object.freeze({
    operation: ModelOperationKind.Export,
    resumeStarting: (run: StartingModelRun, context: StartingRunResumeContext) =>
      resumeExport(dependencies, requireStartingExportRun(run), context),
    cancelStarting: (run: StartingModelRun, options?: ModelWorkbenchOperationOptions) =>
      cancelStartingExport(dependencies, requireStartingExportRun(run), options),
    resolveExecutionSupport: (run: ActiveModelRun): ExecutionSupportRuntime =>
      resolveFrozenExporter(dependencies.setup, requireActiveExportRun(run)).runtime.supports
        .execution,
    complete: (
      run: ActiveExportRun,
      exporter: ResolvedExporterSlot,
      terminal: ExecutionTerminal<ExportCapabilityResult>,
      options?: ModelWorkbenchOperationOptions
    ) => completeExport(dependencies, run, exporter, terminal, options),
    completeObserved: async (
      run: RunningModelRun,
      terminal: ExecutionTerminal<JsonValue>,
      options?: ModelWorkbenchOperationOptions
    ) => {
      const exportRun = requireRunningExportRun(run);
      const exporter = resolveFrozenExporter(dependencies.setup, exportRun);
      try {
        return await completeExport(
          dependencies,
          exportRun,
          exporter,
          parseObservedTerminal(exporter, terminal),
          options
        );
      } catch (cause: unknown) {
        return rejectObservedCompletion(dependencies, exportRun, cause);
      }
    },
    rejectInvalidObservation: (run: RunningModelRun, cause: unknown) =>
      rejectObservedCompletion(dependencies, requireRunningExportRun(run), cause),
    rejectPreparation: (run: ActiveExportRun, cause: unknown) =>
      rejectPreparation(dependencies, run, cause),
    rejectInvocation: (run: ActiveExportRun, cause: unknown) =>
      rejectInvocation(dependencies, run, cause),
    rejectCompletion: (run: ActiveExportRun, cause: unknown) =>
      rejectCompletion(dependencies, run, cause),
  });
}

async function resumeExport(
  dependencies: ExportExecutionHandlerDependencies,
  run: StartingExportRun,
  context: StartingRunResumeContext
) {
  const options = context.options;
  const exporter = resolveFrozenExporter(dependencies.setup, run);
  let materializedSource;
  try {
    materializedSource = await dependencies.materializeModelState(
      Object.freeze({
        runId: run.runId,
        profileId: run.profileId,
        operation: ModelOperationKind.Export,
        state: run.source,
      }),
      options
    );
  } catch (cause: unknown) {
    if (recoveryAbortPreservesStartingRun(context, cause)) throw cause;
    return rejectPreparation(dependencies, run, cause);
  }

  const dispatched = await recordModelRunDispatch(dependencies.runs, dependencies.clock, run);
  let capabilityDispatch;
  try {
    capabilityDispatch = await exporter.capability.export(
      Object.freeze({
        operation: ModelOperationKind.Export,
        profileId: dispatched.profileId,
        runId: dispatched.runId,
        source: materializedSource,
        input: dispatched.input,
      }),
      options
    );
  } catch (cause: unknown) {
    if (recoveryAbortPreservesStartingRun(context, cause)) throw cause;
    return rejectInvocation(dependencies, dispatched, cause);
  }

  try {
    return await acceptCapabilityDispatch(
      dependencies.runs,
      {
        run: dispatched,
        dispatch: capabilityDispatch,
        executionSupport: exporter.runtime.supports.execution,
        complete: (terminal, completionOptions) =>
          completeExport(dependencies, dispatched, exporter, terminal, completionOptions),
      },
      options
    );
  } catch (cause: unknown) {
    if (recoveryAbortPreservesStartingRun(context, cause)) throw cause;
    return rejectCompletion(dependencies, dispatched, cause);
  }
}

function cancelStartingExport(
  dependencies: ExportExecutionHandlerDependencies,
  run: StartingExportRun,
  options?: ModelWorkbenchOperationOptions
): Promise<TerminalExportRun> {
  const exporter = resolveFrozenExporter(dependencies.setup, run);
  return completeExport(
    dependencies,
    run,
    exporter,
    Object.freeze({ status: ExecutionStatus.Cancelled }),
    options
  );
}

async function rejectPreparation(
  dependencies: ExportExecutionHandlerDependencies,
  run: ActiveExportRun,
  cause: unknown
): Promise<never> {
  await recordExportFailure(dependencies, run, preparationFailure(cause));
  throw cause;
}

async function rejectInvocation(
  dependencies: ExportExecutionHandlerDependencies,
  run: ActiveExportRun,
  cause: unknown
): Promise<never> {
  await recordExportFailure(dependencies, run, invocationFailure(cause));
  if (isAbortError(cause)) throw cause;
  throw new ExportCapabilityError(run.runId, { cause });
}

async function rejectCompletion(
  dependencies: ExportExecutionHandlerDependencies,
  run: ActiveExportRun,
  cause: unknown
): Promise<never> {
  if (cause instanceof WorkbenchPersistenceError) throw cause;
  await recordExportFailure(dependencies, run, completionFailure(cause));
  if (isAbortError(cause) || cause instanceof ExportArtifactVerificationError) throw cause;
  throw new ExportCapabilityError(run.runId, { cause });
}

function resolveFrozenExporter(
  setup: ResolvedWorkbenchSetup,
  run: ActiveExportRun
): ResolvedExporterSlot {
  const profile = findResolvedProfile(setup, run.profileId);
  const exporter = profile && findResolvedExporter(profile, run.exporterId);
  if (
    exporter === undefined ||
    exporter.capability.capabilityId !== run.capabilityId ||
    exporter.runtime.runtimeBindingId !== run.runtimeBindingId ||
    exporter.evidenceDigest !== run.slotEvidenceDigest ||
    (run.status === ModelRunStatus.Running &&
      exporter.runtime.supports.execution.runtimeSupportId !== run.execution.runtimeSupportId)
  ) {
    throw new RunExecutionSupportMismatchError(run.runId);
  }
  return exporter;
}

function parseObservedTerminal(
  exporter: ResolvedExporterSlot,
  terminal: ExecutionTerminal<JsonValue>
): ExecutionTerminal<ExportCapabilityResult> {
  if (terminal.status !== ExecutionStatus.Succeeded) return terminal;
  return Object.freeze({
    status: ExecutionStatus.Succeeded,
    result: exporter.capability.parseResult(terminal.result, 'executionSupport.observation.result'),
  });
}

async function rejectObservedCompletion(
  dependencies: ExportExecutionHandlerDependencies,
  run: RunningExportRun,
  cause: unknown
): Promise<never> {
  if (isAbortError(cause)) throw cause;
  if (cause instanceof ExportArtifactVerificationError) {
    await recordExportFailure(dependencies, run, observedResultFailure(cause));
    throw cause;
  }
  if (!isProtocolOrCompletionError(cause)) throw cause;
  await recordExportFailure(dependencies, run, observedResultFailure(cause));
  throw new ExportCapabilityError(run.runId, { cause });
}

function requireActiveExportRun(run: ActiveModelRun): ActiveExportRun {
  if (run.operation !== ModelOperationKind.Export) {
    throw new RunExecutionSupportMismatchError(run.runId);
  }
  return run;
}

function requireRunningExportRun(run: RunningModelRun): RunningExportRun {
  if (run.operation !== ModelOperationKind.Export) {
    throw new RunExecutionSupportMismatchError(run.runId);
  }
  return run;
}

function requireStartingExportRun(run: StartingModelRun): StartingExportRun {
  if (run.operation !== ModelOperationKind.Export) {
    throw new RunExecutionSupportMismatchError(run.runId);
  }
  return run;
}

function isProtocolOrCompletionError(cause: unknown): boolean {
  return cause instanceof InvalidWorkbenchValueError || cause instanceof WorkbenchExtensionError;
}

function observedResultFailure(cause: unknown): ExecutionFailure {
  return parseExecutionFailure({
    code: 'EXPORT_OBSERVED_RESULT_INVALID',
    message: 'Observed Export result could not be accepted.',
    retryable: false,
    diagnostics: { cause: cause instanceof Error ? cause.message : 'unknown error' },
  });
}

function preparationFailure(cause: unknown): ExecutionFailure {
  if (isAbortError(cause)) {
    return defineExecutionFailure('EXPORT_ABORTED', 'Export was aborted before dispatch.');
  }
  return defineExecutionFailure(
    'EXPORT_SOURCE_PREPARATION_FAILED',
    'Export source parameters could not be prepared.'
  );
}

function invocationFailure(cause: unknown): ExecutionFailure {
  if (isAbortError(cause)) {
    return defineExecutionFailure('EXPORT_ABORTED', 'Export was aborted before dispatch.');
  }
  return defineExecutionFailure(
    'EXPORT_CAPABILITY_FAILED',
    'Exporter Capability did not produce a valid result.'
  );
}

function completionFailure(cause: unknown): ExecutionFailure {
  if (isAbortError(cause)) {
    return defineExecutionFailure('EXPORT_ABORTED', 'Export completion was aborted.');
  }
  if (cause instanceof ExportArtifactVerificationError) {
    return defineExecutionFailure(
      'EXPORT_ARTIFACT_VERIFICATION_FAILED',
      'Export produced an Artifact that could not be verified.'
    );
  }
  return defineExecutionFailure(
    'EXPORT_CAPABILITY_FAILED',
    'Exporter Capability did not produce a valid result.'
  );
}

function defineExecutionFailure(code: string, message: string): ExecutionFailure {
  return parseExecutionFailure({ code, message, retryable: false });
}

function isAbortError(cause: unknown): boolean {
  return cause instanceof Error && cause.name === 'AbortError';
}
