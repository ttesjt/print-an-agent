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
  type TerminalTrainingRun,
} from '@ta-agent/workbench-domain';
import {
  ExecutionStatus,
  WorkbenchExtensionError,
  type ExecutionSupportRuntime,
  type ExecutionTerminal,
  type TrainingCapabilityResult,
} from '@ta-agent/workbench-extension';
import { WorkbenchPersistenceError, type TrainingCommitter } from '@ta-agent/workbench-persistence';
import {
  findResolvedProfile,
  findResolvedTrainer,
  type ResolvedTrainerSlot,
  type ResolvedWorkbenchSetup,
} from '@ta-agent/workbench-setup';

import { completeTraining, recordTrainingFailure } from './complete-training.js';
import { TrainingArtifactVerificationError, TrainingCapabilityError } from './errors.js';
import type {
  ModelWorkbenchOperationOptions,
  OperationExecutionHandler,
} from '../../execution/contracts.js';
import { RunExecutionSupportMismatchError } from '../../execution/errors.js';
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
  readonly idSource: WorkbenchIdSource;
}

export function createTrainingExecutionHandler(
  dependencies: TrainingExecutionHandlerDependencies
): TrainingExecutionHandler {
  return Object.freeze({
    operation: ModelOperationKind.Training,
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
    rejectPreparation: async (run: ActiveTrainingRun, cause: unknown) => {
      await recordTrainingFailure(dependencies.trainingCommitter, run, preparationFailure(cause));
      throw cause;
    },
    rejectInvocation: async (run: ActiveTrainingRun, cause: unknown) => {
      await recordTrainingFailure(dependencies.trainingCommitter, run, invocationFailure(cause));
      if (isAbortError(cause)) throw cause;
      throw new TrainingCapabilityError(run.runId, { cause });
    },
    rejectCompletion: async (run: ActiveTrainingRun, cause: unknown) => {
      if (cause instanceof WorkbenchPersistenceError) throw cause;
      await recordTrainingFailure(dependencies.trainingCommitter, run, completionFailure(cause));
      if (isAbortError(cause) || cause instanceof TrainingArtifactVerificationError) throw cause;
      throw new TrainingCapabilityError(run.runId, { cause });
    },
  });
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
    await recordTrainingFailure(dependencies.trainingCommitter, run, observedResultFailure(cause));
    throw cause;
  }
  if (!isProtocolOrCompletionError(cause)) throw cause;
  await recordTrainingFailure(dependencies.trainingCommitter, run, observedResultFailure(cause));
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
