import {
  defineStartingInitializationRun,
  ModelOperationKind,
  parseInitializerId,
  parseJsonValue,
  parseProfileId,
  parseRunId,
} from '@ta-agent/workbench-domain';
import {
  findResolvedInitializer,
  findResolvedProfile,
  type ResolvedWorkbenchSetup,
} from '@ta-agent/workbench-setup';
import type { RunRepository } from '@ta-agent/workbench-persistence';

import type { StartInitializationInput, StartInitializationResult } from './contracts.js';
import { InitializerSlotNotFoundError, ModelProfileNotFoundError } from './errors.js';
import type { InitializationExecutionHandler } from './initialization-execution-handler.js';
import type {
  ExecutionLifecycle,
  ModelWorkbenchOperationOptions,
} from '../../execution/contracts.js';
import type { WorkbenchIdSource } from '../../ports/workbench-id-source.js';

export interface StartInitializationDependencies {
  readonly setup: ResolvedWorkbenchSetup;
  readonly runs: RunRepository;
  readonly lifecycle: ExecutionLifecycle;
  readonly handler: InitializationExecutionHandler;
  readonly idSource: WorkbenchIdSource;
}

export function createStartInitialization(dependencies: StartInitializationDependencies) {
  return async function startInitialization(
    input: StartInitializationInput,
    options?: ModelWorkbenchOperationOptions
  ): Promise<StartInitializationResult> {
    assertNotAborted(options?.signal);
    const profileId = parseProfileId(input.profileId, 'initialization.profileId');
    const initializerId = parseInitializerId(input.initializerId, 'initialization.initializerId');
    const operationInput = parseJsonValue(input.input, 'initialization.input');
    const profile = findResolvedProfile(dependencies.setup, profileId);
    if (profile === undefined) throw new ModelProfileNotFoundError(profileId);
    const initializer = findResolvedInitializer(profile, initializerId);
    if (initializer === undefined) {
      throw new InitializerSlotNotFoundError(profileId, initializerId);
    }

    const runId = parseRunId(dependencies.idSource.nextId('run'), 'generated.runId');
    const starting = defineStartingInitializationRun({
      runId,
      profileId,
      initializerId,
      capabilityId: initializer.capability.capabilityId,
      runtimeBindingId: initializer.runtime.runtimeBindingId,
      slotEvidenceDigest: initializer.evidenceDigest,
    });
    await dependencies.runs.create(starting);

    try {
      const dispatch = await initializer.capability.initialize(
        Object.freeze({
          operation: ModelOperationKind.Initialization,
          runId,
          input: operationInput,
        }),
        options
      );
      await dependencies.lifecycle.acceptCapabilityDispatch(
        {
          run: starting,
          dispatch,
          complete: (terminal, completionOptions) =>
            dependencies.handler.complete(starting, initializer, terminal, completionOptions),
        },
        options
      );
      return Object.freeze({ runId });
    } catch (cause: unknown) {
      return dependencies.handler.rejectStart(starting, cause);
    }
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
