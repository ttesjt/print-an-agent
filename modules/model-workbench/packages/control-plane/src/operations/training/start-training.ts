import {
  defineModelState,
  defineStartingTrainingRun,
  parseProfileId,
  parseRunId,
  parseTrainerId,
} from '@print-an-agent/workbench-domain';
import type { RunRepository } from '@print-an-agent/workbench-persistence';
import {
  findResolvedProfile,
  findResolvedTrainer,
  type ResolvedWorkbenchSetup,
} from '@print-an-agent/workbench-setup';

import type { StartTrainingInput, StartTrainingResult } from './contracts.js';
import { TrainerSlotNotFoundError } from './errors.js';
import type { TrainingExecutionHandler } from './training-execution-handler.js';
import {
  StartingRunResumeKind,
  type ModelWorkbenchOperationOptions,
} from '../../execution/contracts.js';
import { defineStartingRunResumeContext } from '../../execution/dispatch-model-run.js';
import type { WorkbenchIdSource } from '../../ports/workbench-id-source.js';
import { readWorkbenchClock, type WorkbenchClock } from '../../ports/workbench-clock.js';
import { ModelProfileNotFoundError } from '../errors.js';

export interface StartTrainingDependencies {
  readonly setup: ResolvedWorkbenchSetup;
  readonly runs: RunRepository;
  readonly handler: TrainingExecutionHandler;
  readonly idSource: WorkbenchIdSource;
  readonly clock: WorkbenchClock;
}

export function createStartTraining(dependencies: StartTrainingDependencies) {
  return async function startTraining(
    input: StartTrainingInput,
    options?: ModelWorkbenchOperationOptions
  ): Promise<StartTrainingResult> {
    assertNotAborted(options?.signal);
    const profileId = parseProfileId(input.profileId, 'training.profileId');
    const trainerId = parseTrainerId(input.trainerId, 'training.trainerId');
    const source = defineModelState(input.source);
    const profile = findResolvedProfile(dependencies.setup, profileId);
    if (profile === undefined) throw new ModelProfileNotFoundError(profileId);
    const trainer = findResolvedTrainer(profile, trainerId);
    if (trainer === undefined) throw new TrainerSlotNotFoundError(profileId, trainerId);
    const operationInput = trainer.capability.contracts.input.parse(input.input, 'training.input');

    const runId = parseRunId(dependencies.idSource.nextId('run'), 'generated.runId');
    const starting = defineStartingTrainingRun({
      runId,
      profileId,
      trainerId,
      capabilityId: trainer.capability.capabilityId,
      runtimeBindingId: trainer.runtime.runtimeBindingId,
      slotEvidenceDigest: trainer.evidenceDigest,
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
  const error = new Error('Training was aborted before capability invocation.', {
    cause: signal.reason,
  });
  error.name = 'AbortError';
  throw error;
}
