import {
  defineStartingInitializationRun,
  parseInitializerId,
  parseProfileId,
  parseRunId,
} from '@print-an-agent/workbench-domain';
import {
  findResolvedInitializer,
  findResolvedProfile,
  type ResolvedWorkbenchSetup,
} from '@print-an-agent/workbench-setup';
import type { RunRepository } from '@print-an-agent/workbench-persistence';
import type { StartInitializationInput, StartInitializationResult } from './contracts.js';
import { InitializerSlotNotFoundError } from './errors.js';
import type { InitializationExecutionHandler } from './initialization-execution-handler.js';
import {
  StartingRunResumeKind,
  type ModelWorkbenchOperationOptions,
} from '../../execution/contracts.js';
import { defineStartingRunResumeContext } from '../../execution/dispatch-model-run.js';
import type { WorkbenchIdSource } from '../../ports/workbench-id-source.js';
import { readWorkbenchClock, type WorkbenchClock } from '../../ports/workbench-clock.js';
import { ModelProfileNotFoundError } from '../errors.js';

export interface StartInitializationDependencies {
  readonly setup: ResolvedWorkbenchSetup;
  readonly runs: RunRepository;
  readonly handler: InitializationExecutionHandler;
  readonly idSource: WorkbenchIdSource;
  readonly clock: WorkbenchClock;
}

export function createStartInitialization(dependencies: StartInitializationDependencies) {
  return async function startInitialization(
    input: StartInitializationInput,
    options?: ModelWorkbenchOperationOptions
  ): Promise<StartInitializationResult> {
    assertNotAborted(options?.signal);
    const profileId = parseProfileId(input.profileId, 'initialization.profileId');
    const initializerId = parseInitializerId(input.initializerId, 'initialization.initializerId');
    const profile = findResolvedProfile(dependencies.setup, profileId);
    if (profile === undefined) throw new ModelProfileNotFoundError(profileId);
    const initializer = findResolvedInitializer(profile, initializerId);
    if (initializer === undefined) {
      throw new InitializerSlotNotFoundError(profileId, initializerId);
    }
    const operationInput = initializer.capability.contracts.input.parse(
      input.input,
      'initialization.input'
    );

    const runId = parseRunId(dependencies.idSource.nextId('run'), 'generated.runId');
    const starting = defineStartingInitializationRun({
      runId,
      profileId,
      initializerId,
      capabilityId: initializer.capability.capabilityId,
      runtimeBindingId: initializer.runtime.runtimeBindingId,
      slotEvidenceDigest: initializer.evidenceDigest,
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
  const error = new Error('Initialization was aborted before capability invocation.', {
    cause: signal.reason,
  });
  error.name = 'AbortError';
  throw error;
}
