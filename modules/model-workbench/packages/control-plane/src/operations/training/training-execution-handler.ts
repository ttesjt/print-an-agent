import {
  InvalidWorkbenchValueError,
  ModelOperationKind,
  ModelRunStatus,
  parseExecutionFailure,
  type ActiveModelRun,
  type ActiveTrainingRun,
  type ExecutionFailure,
  type JsonValue,
  type RunningModelRun,
  type RunningTrainingRun,
  type StartingModelRun,
  type StartingTrainingRun,
  type TerminalTrainingRun,
} from '@print-an-agent/workbench-domain';
import {
  ExecutionStatus,
  WorkbenchExtensionError,
  type ExecutionSupportRuntime,
  type ExecutionTerminal,
  type TrainingCapabilityResult,
} from '@print-an-agent/workbench-extension';
import {
  WorkbenchPersistenceError,
  type RunRepository,
  type TrainingCommitter,
} from '@print-an-agent/workbench-persistence';
import {
  findResolvedProfile,
  findResolvedTrainer,
  type ResolvedTrainerSlot,
  type ResolvedWorkbenchSetup,
} from '@print-an-agent/workbench-setup';

import { completeTraining, recordTrainingFailure } from './complete-training.js';
import { TrainingArtifactVerificationError, TrainingCapabilityError } from './errors.js';
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

export interface TrainingExecutionHandler extends OperationExecutionHandler {
  readonly operation: typeof ModelOperationKind.Training;
  complete(
    run: ActiveTrainingRun,
    trainer: ResolvedTrainerSlot,
    terminal: ExecutionTerminal<TrainingCapabilityResult>,
    options?: ModelWorkbenchOperationOptions
  ): Promise<TerminalTrainingRun>;
  rejectPreparation(run: ActiveTrainingRun, cause: unknown): Promise<never>;
  rejectInvocation(run: ActiveTrainingRun, cause: unknown): Promise<never>;
  rejectCompletion(run: ActiveTrainingRun, cause: unknown): Promise<never>;
}

export interface TrainingExecutionHandlerDependencies {
  readonly setup: ResolvedWorkbenchSetup;
  readonly trainingCommitter: TrainingCommitter;
  readonly runs: RunRepository;
  readonly materializeModelState: MaterializeModelState;
  readonly idSource: WorkbenchIdSource;
  readonly clock: WorkbenchClock;
}

export function createTrainingExecutionHandler(
  dependencies: TrainingExecutionHandlerDependencies
): TrainingExecutionHandler {
  return Object.freeze({
    operation: ModelOperationKind.Training,
    resumeStarting: (run: StartingModelRun, context: StartingRunResumeContext) =>
      resumeTraining(dependencies, requireStartingTrainingRun(run), context),
    cancelStarting: (run: StartingModelRun, options?: ModelWorkbenchOperationOptions) =>
      cancelStartingTraining(dependencies, requireStartingTrainingRun(run), options),
    resolveExecutionSupport: (run: ActiveModelRun): ExecutionSupportRuntime =>
      resolveFrozenTrainer(dependencies.setup, requireActiveTrainingRun(run)).runtime.supports
        .execution,
    complete: (
      run: ActiveTrainingRun,
      trainer: ResolvedTrainerSlot,
      terminal: ExecutionTerminal<TrainingCapabilityResult>,
      options?: ModelWorkbenchOperationOptions
    ) => completeTraining(dependencies, run, trainer, terminal, options),
    completeObserved: async (
      run: RunningModelRun,
      terminal: ExecutionTerminal<JsonValue>,
      options?: ModelWorkbenchOperationOptions
    ) => {
      const trainingRun = requireRunningTrainingRun(run);
      const trainer = resolveFrozenTrainer(dependencies.setup, trainingRun);
      try {
        return await completeTraining(
          dependencies,
          trainingRun,
          trainer,
          parseObservedTerminal(trainer, terminal),
          options
        );
      } catch (cause: unknown) {
        return rejectObservedCompletion(dependencies, trainingRun, cause);
      }
    },
    rejectInvalidObservation: (run: RunningModelRun, cause: unknown) =>
      rejectObservedCompletion(dependencies, requireRunningTrainingRun(run), cause),
    rejectPreparation: (run: ActiveTrainingRun, cause: unknown) =>
      rejectPreparation(dependencies, run, cause),
    rejectInvocation: (run: ActiveTrainingRun, cause: unknown) =>
      rejectInvocation(dependencies, run, cause),
    rejectCompletion: (run: ActiveTrainingRun, cause: unknown) =>
      rejectCompletion(dependencies, run, cause),
  });
}

async function resumeTraining(
  dependencies: TrainingExecutionHandlerDependencies,
  run: StartingTrainingRun,
  context: StartingRunResumeContext
) {
  const options = context.options;
  const trainer = resolveFrozenTrainer(dependencies.setup, run);
  let materializedSource;
  try {
    materializedSource = await dependencies.materializeModelState(
      Object.freeze({
        runId: run.runId,
        profileId: run.profileId,
        operation: ModelOperationKind.Training,
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
    capabilityDispatch = await trainer.capability.train(
      Object.freeze({
        operation: ModelOperationKind.Training,
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
        executionSupport: trainer.runtime.supports.execution,
        complete: (terminal, completionOptions) =>
          completeTraining(dependencies, dispatched, trainer, terminal, completionOptions),
      },
      options
    );
  } catch (cause: unknown) {
    if (recoveryAbortPreservesStartingRun(context, cause)) throw cause;
    return rejectCompletion(dependencies, dispatched, cause);
  }
}

function cancelStartingTraining(
  dependencies: TrainingExecutionHandlerDependencies,
  run: StartingTrainingRun,
  options?: ModelWorkbenchOperationOptions
): Promise<TerminalTrainingRun> {
  const trainer = resolveFrozenTrainer(dependencies.setup, run);
  return completeTraining(
    dependencies,
    run,
    trainer,
    Object.freeze({ status: ExecutionStatus.Cancelled }),
    options
  );
}

async function rejectPreparation(
  dependencies: TrainingExecutionHandlerDependencies,
  run: ActiveTrainingRun,
  cause: unknown
): Promise<never> {
  await recordTrainingFailure(dependencies, run, preparationFailure(cause));
  throw cause;
}

async function rejectInvocation(
  dependencies: TrainingExecutionHandlerDependencies,
  run: ActiveTrainingRun,
  cause: unknown
): Promise<never> {
  await recordTrainingFailure(dependencies, run, invocationFailure(cause));
  if (isAbortError(cause)) throw cause;
  throw new TrainingCapabilityError(run.runId, { cause });
}

async function rejectCompletion(
  dependencies: TrainingExecutionHandlerDependencies,
  run: ActiveTrainingRun,
  cause: unknown
): Promise<never> {
  if (cause instanceof WorkbenchPersistenceError) throw cause;
  await recordTrainingFailure(dependencies, run, completionFailure(cause));
  if (isAbortError(cause) || cause instanceof TrainingArtifactVerificationError) throw cause;
  throw new TrainingCapabilityError(run.runId, { cause });
}

function resolveFrozenTrainer(
  setup: ResolvedWorkbenchSetup,
  run: ActiveTrainingRun
): ResolvedTrainerSlot {
  const profile = findResolvedProfile(setup, run.profileId);
  const trainer = profile && findResolvedTrainer(profile, run.trainerId);
  if (
    trainer === undefined ||
    trainer.capability.capabilityId !== run.capabilityId ||
    trainer.runtime.runtimeBindingId !== run.runtimeBindingId ||
    trainer.evidenceDigest !== run.slotEvidenceDigest ||
    (run.status === ModelRunStatus.Running &&
      trainer.runtime.supports.execution.runtimeSupportId !== run.execution.runtimeSupportId)
  ) {
    throw new RunExecutionSupportMismatchError(run.runId);
  }
  return trainer;
}

function parseObservedTerminal(
  trainer: ResolvedTrainerSlot,
  terminal: ExecutionTerminal<JsonValue>
): ExecutionTerminal<TrainingCapabilityResult> {
  if (terminal.status !== ExecutionStatus.Succeeded) return terminal;
  return Object.freeze({
    status: ExecutionStatus.Succeeded,
    result: trainer.capability.parseResult(terminal.result, 'executionSupport.observation.result'),
  });
}

async function rejectObservedCompletion(
  dependencies: TrainingExecutionHandlerDependencies,
  run: RunningTrainingRun,
  cause: unknown
): Promise<never> {
  if (isAbortError(cause)) throw cause;
  if (cause instanceof TrainingArtifactVerificationError) {
    await recordTrainingFailure(dependencies, run, observedResultFailure(cause));
    throw cause;
  }
  if (!isProtocolOrCompletionError(cause)) throw cause;
  await recordTrainingFailure(dependencies, run, observedResultFailure(cause));
  throw new TrainingCapabilityError(run.runId, { cause });
}

function requireActiveTrainingRun(run: ActiveModelRun): ActiveTrainingRun {
  if (run.operation !== ModelOperationKind.Training) {
    throw new RunExecutionSupportMismatchError(run.runId);
  }
  return run;
}

function requireRunningTrainingRun(run: RunningModelRun): RunningTrainingRun {
  if (run.operation !== ModelOperationKind.Training) {
    throw new RunExecutionSupportMismatchError(run.runId);
  }
  return run;
}

function requireStartingTrainingRun(run: StartingModelRun): StartingTrainingRun {
  if (run.operation !== ModelOperationKind.Training) {
    throw new RunExecutionSupportMismatchError(run.runId);
  }
  return run;
}

function isProtocolOrCompletionError(cause: unknown): boolean {
  return cause instanceof InvalidWorkbenchValueError || cause instanceof WorkbenchExtensionError;
}

function observedResultFailure(cause: unknown): ExecutionFailure {
  return parseExecutionFailure({
    code: 'TRAINING_OBSERVED_RESULT_INVALID',
    message: 'Observed Training result could not be accepted.',
    retryable: false,
    diagnostics: { cause: cause instanceof Error ? cause.message : 'unknown error' },
  });
}

function preparationFailure(cause: unknown): ExecutionFailure {
  if (isAbortError(cause)) {
    return defineExecutionFailure('TRAINING_ABORTED', 'Training was aborted before dispatch.');
  }
  return defineExecutionFailure(
    'TRAINING_SOURCE_PREPARATION_FAILED',
    'Training source parameters could not be prepared.'
  );
}

function invocationFailure(cause: unknown): ExecutionFailure {
  if (isAbortError(cause)) {
    return defineExecutionFailure('TRAINING_ABORTED', 'Training was aborted before dispatch.');
  }
  return defineExecutionFailure(
    'TRAINING_CAPABILITY_FAILED',
    'Trainer Capability did not produce a valid result.'
  );
}

function completionFailure(cause: unknown): ExecutionFailure {
  if (isAbortError(cause)) {
    return defineExecutionFailure('TRAINING_ABORTED', 'Training completion was aborted.');
  }
  if (cause instanceof TrainingArtifactVerificationError) {
    return defineExecutionFailure(
      'TRAINING_ARTIFACT_VERIFICATION_FAILED',
      'Training produced an Artifact that could not be verified.'
    );
  }
  return defineExecutionFailure(
    'TRAINING_CAPABILITY_FAILED',
    'Trainer Capability did not produce a valid result.'
  );
}

function defineExecutionFailure(code: string, message: string): ExecutionFailure {
  return parseExecutionFailure({ code, message, retryable: false });
}

function isAbortError(cause: unknown): boolean {
  return cause instanceof Error && cause.name === 'AbortError';
}
