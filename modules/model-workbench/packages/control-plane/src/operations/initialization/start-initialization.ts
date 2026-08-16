import {
  defineModelBase,
  defineRunningInitializationRun,
  failModelRun,
  ModelOperationKind,
  parseArtifactId,
  parseBaseId,
  parseExecutionFailure,
  parseInitializerId,
  parseJsonValue,
  parseProfileId,
  parseRunId,
  succeedInitializationRun,
  type ExecutionFailure,
  type RunningModelRun,
} from '@ta-agent/workbench-domain';
import {
  CapabilityOutcomeStatus,
  parseInitializationCapabilityOutcome,
} from '@ta-agent/workbench-extension';
import {
  findResolvedInitializer,
  findResolvedProfile,
  type ResolvedWorkbenchSetup,
} from '@ta-agent/workbench-setup';
import type { InitializationCommitter, RunRepository } from '@ta-agent/workbench-persistence';

import type {
  ModelWorkbenchOperationOptions,
  StartInitializationInput,
  StartInitializationResult,
} from './contracts.js';
import type { WorkbenchIdSource } from '../../ports/workbench-id-source.js';
import {
  InitializationArtifactMismatchError,
  InitializationArtifactVerificationError,
  InitializationCapabilityError,
  InitializerSlotNotFoundError,
  ModelProfileNotFoundError,
} from './errors.js';

export interface StartInitializationDependencies {
  readonly setup: ResolvedWorkbenchSetup;
  readonly runs: RunRepository;
  readonly initializationCommitter: InitializationCommitter;
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
    const baseId = parseBaseId(dependencies.idSource.nextId('base'), 'generated.baseId');
    const artifactId = parseArtifactId(
      dependencies.idSource.nextId('artifact'),
      'generated.artifactId'
    );
    const running = defineRunningInitializationRun({
      runId,
      profileId,
      initializerId,
      capabilityId: initializer.capability.capabilityId,
      runtimeBindingId: initializer.runtime.runtimeBindingId,
      slotEvidenceDigest: initializer.evidenceDigest,
    });
    await dependencies.runs.create(running);

    try {
      const rawOutcome = await initializer.capability.initialize(
        Object.freeze({
          operation: ModelOperationKind.Initialization,
          runId,
          plannedArtifactId: artifactId,
          input: operationInput,
        }),
        options
      );
      const outcome = parseInitializationCapabilityOutcome(rawOutcome);
      if (outcome.status === CapabilityOutcomeStatus.Failed) {
        const failed = failModelRun(running, outcome.failure);
        await dependencies.initializationCommitter.commit({ run: failed });
        return Object.freeze({
          status: CapabilityOutcomeStatus.Failed,
          runId,
          failure: outcome.failure,
        });
      }
      if (outcome.artifact.artifactId !== artifactId) {
        throw new InitializationArtifactMismatchError(artifactId, outcome.artifact.artifactId);
      }
      try {
        await initializer.runtime.supports.artifactVerifier.verify(
          Object.freeze({ artifact: outcome.artifact }),
          options
        );
      } catch (cause: unknown) {
        if (isAbortError(cause)) throw cause;
        throw new InitializationArtifactVerificationError(runId, artifactId, { cause });
      }
      const base = defineModelBase({
        baseId,
        profileId,
        artifact: outcome.artifact,
        lineage: {
          kind: ModelOperationKind.Initialization,
          runId,
          initializerId,
          capabilityId: initializer.capability.capabilityId,
          runtimeBindingId: initializer.runtime.runtimeBindingId,
          slotEvidenceDigest: initializer.evidenceDigest,
        },
      });
      const succeeded = succeedInitializationRun(running, baseId, outcome.data);
      await dependencies.initializationCommitter.commit({ run: succeeded, base });
      return Object.freeze({ status: CapabilityOutcomeStatus.Succeeded, runId, baseId });
    } catch (error: unknown) {
      await recordExecutionFailure(dependencies.initializationCommitter, running, error);
      if (error instanceof InitializationArtifactVerificationError) throw error;
      throw new InitializationCapabilityError(runId, { cause: error });
    }
  };
}

async function recordExecutionFailure(
  initializationCommitter: InitializationCommitter,
  running: RunningModelRun,
  cause: unknown
): Promise<void> {
  const failure = executionFailure(cause);
  try {
    await initializationCommitter.commit({ run: failModelRun(running, failure) });
  } catch {
    // Preserve the original capability or protocol failure. The persistence adapter is the only
    // component that can safely reconcile a failed terminal commit.
  }
}

function executionFailure(cause: unknown): ExecutionFailure {
  if (isAbortError(cause)) {
    return defineExecutionFailure(
      'INITIALIZATION_ABORTED',
      'Initialization was aborted before producing a result.'
    );
  }
  if (cause instanceof InitializationArtifactVerificationError) {
    return defineExecutionFailure(
      'INITIALIZATION_ARTIFACT_VERIFICATION_FAILED',
      'Initialization produced an Artifact that could not be verified.'
    );
  }
  return defineExecutionFailure(
    'INITIALIZATION_CAPABILITY_FAILED',
    'Initializer Capability did not produce a valid result.'
  );
}

function defineExecutionFailure(code: string, message: string): ExecutionFailure {
  return parseExecutionFailure({ code, message, retryable: false });
}

function isAbortError(cause: unknown): boolean {
  return cause instanceof Error && cause.name === 'AbortError';
}

function assertNotAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted !== true) return;
  const error = new Error('Initialization was aborted before capability invocation.', {
    cause: signal.reason,
  });
  error.name = 'AbortError';
  throw error;
}
