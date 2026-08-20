import {
  defineModelState,
  defineStartingTrainingRun,
  ModelOperationKind,
  parseJsonValue,
  parseProfileId,
  parseRunId,
  parseTrainerId,
} from '@ta-agent/workbench-domain';
import type {
  CapabilityDispatch,
  MaterializedModelState,
  TrainingCapabilityResult,
} from '@ta-agent/workbench-extension';
import type { RunRepository } from '@ta-agent/workbench-persistence';
import {
  findResolvedProfile,
  findResolvedTrainer,
  type ResolvedWorkbenchSetup,
} from '@ta-agent/workbench-setup';

import type { StartTrainingInput, StartTrainingResult } from './contracts.js';
import { TrainerSlotNotFoundError } from './errors.js';
import type { TrainingExecutionHandler } from './training-execution-handler.js';
import type {
  ExecutionLifecycle,
  ModelWorkbenchOperationOptions,
} from '../../execution/contracts.js';
import type { WorkbenchIdSource } from '../../ports/workbench-id-source.js';
import type { MaterializeModelState } from '../../model-states/materialize-model-state.js';
import { ModelProfileNotFoundError } from '../errors.js';

export interface StartTrainingDependencies {
  readonly setup: ResolvedWorkbenchSetup;
  readonly runs: RunRepository;
  readonly lifecycle: ExecutionLifecycle;
  readonly handler: TrainingExecutionHandler;
  readonly materializeModelState: MaterializeModelState;
  readonly idSource: WorkbenchIdSource;
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
    const operationInput = parseJsonValue(input.input, 'training.input');
    const profile = findResolvedProfile(dependencies.setup, profileId);
    if (profile === undefined) throw new ModelProfileNotFoundError(profileId);
    const trainer = findResolvedTrainer(profile, trainerId);
    if (trainer === undefined) throw new TrainerSlotNotFoundError(profileId, trainerId);

    const runId = parseRunId(dependencies.idSource.nextId('run'), 'generated.runId');
    const starting = defineStartingTrainingRun({
      runId,
      profileId,
      trainerId,
      capabilityId: trainer.capability.capabilityId,
      runtimeBindingId: trainer.runtime.runtimeBindingId,
      slotEvidenceDigest: trainer.evidenceDigest,
      source,
    });
    await dependencies.runs.create(starting);

    let materializedSource: MaterializedModelState;
    try {
      materializedSource = await dependencies.materializeModelState(
        Object.freeze({ runId, profileId, operation: ModelOperationKind.Training, state: source }),
        options
      );
    } catch (cause: unknown) {
      return dependencies.handler.rejectPreparation(starting, cause);
    }

    let dispatch: CapabilityDispatch<TrainingCapabilityResult>;
    try {
      dispatch = await trainer.capability.train(
        Object.freeze({
          operation: ModelOperationKind.Training,
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
            dependencies.handler.complete(starting, trainer, terminal, completionOptions),
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
  const error = new Error('Training was aborted before capability invocation.', {
    cause: signal.reason,
  });
  error.name = 'AbortError';
  throw error;
}
