import {
  InvalidWorkbenchValueError,
  ModelOperationKind,
  ModelRunStatus,
  parseExecutionFailure,
  type ActiveInitializationRun,
  type ActiveModelRun,
  type ExecutionFailure,
  type JsonValue,
  type RunningInitializationRun,
  type RunningModelRun,
  type TerminalInitializationRun,
} from '@ta-agent/workbench-domain';
import {
  ExecutionStatus,
  WorkbenchExtensionError,
  type ExecutionSupportRuntime,
  type ExecutionTerminal,
  type InitializationCapabilityResult,
} from '@ta-agent/workbench-extension';
import {
  findResolvedInitializer,
  findResolvedProfile,
  type ResolvedInitializerSlot,
  type ResolvedWorkbenchSetup,
} from '@ta-agent/workbench-setup';
import {
  WorkbenchPersistenceError,
  type InitializationCommitter,
} from '@ta-agent/workbench-persistence';

import { completeInitialization, recordInitializationFailure } from './complete-initialization.js';
import {
  InitializationArtifactVerificationError,
  InitializationCapabilityError,
} from './errors.js';
import type {
  ModelWorkbenchOperationOptions,
  OperationExecutionHandler,
} from '../../execution/contracts.js';
import { RunExecutionSupportMismatchError } from '../../execution/errors.js';
import type { WorkbenchIdSource } from '../../ports/workbench-id-source.js';

export interface InitializationExecutionHandler extends OperationExecutionHandler {
  readonly operation: typeof ModelOperationKind.Initialization;
  complete(
    run: ActiveInitializationRun,
    initializer: ResolvedInitializerSlot,
    terminal: ExecutionTerminal<InitializationCapabilityResult>,
    options?: ModelWorkbenchOperationOptions
  ): Promise<TerminalInitializationRun>;
  rejectInvocation(run: ActiveInitializationRun, cause: unknown): Promise<never>;
  rejectCompletion(run: ActiveInitializationRun, cause: unknown): Promise<never>;
}

export interface InitializationExecutionHandlerDependencies {
  readonly setup: ResolvedWorkbenchSetup;
  readonly initializationCommitter: InitializationCommitter;
  readonly idSource: WorkbenchIdSource;
}

export function createInitializationExecutionHandler(
  dependencies: InitializationExecutionHandlerDependencies
): InitializationExecutionHandler {
  return Object.freeze({
    operation: ModelOperationKind.Initialization,
    resolveExecutionSupport: (run: ActiveModelRun): ExecutionSupportRuntime =>
      resolveFrozenInitializer(dependencies.setup, requireActiveInitializationRun(run)).runtime
        .supports.execution,
    complete: (
      run: ActiveInitializationRun,
      initializer: ResolvedInitializerSlot,
      terminal: ExecutionTerminal<InitializationCapabilityResult>,
      options?: ModelWorkbenchOperationOptions
    ) => completeInitialization(dependencies, run, initializer, terminal, options),
    completeObserved: async (
      run: RunningModelRun,
      terminal: ExecutionTerminal<JsonValue>,
      options?: ModelWorkbenchOperationOptions
    ) => {
      const initializationRun = requireRunningInitializationRun(run);
      const initializer = resolveFrozenInitializer(dependencies.setup, initializationRun);
      try {
        return await completeInitialization(
          dependencies,
          initializationRun,
          initializer,
          parseObservedTerminal(initializer, terminal),
          options
        );
      } catch (cause: unknown) {
        return rejectObservedCompletion(dependencies, initializationRun, cause);
      }
    },
    rejectInvalidObservation: (run: RunningModelRun, cause: unknown) =>
      rejectObservedCompletion(dependencies, requireRunningInitializationRun(run), cause),
    rejectInvocation: async (run: ActiveInitializationRun, cause: unknown) => {
      await recordInitializationFailure(
        dependencies.initializationCommitter,
        run,
        startFailure(cause)
      );
      if (isAbortError(cause)) throw cause;
      throw new InitializationCapabilityError(run.runId, { cause });
    },
    rejectCompletion: async (run: ActiveInitializationRun, cause: unknown) => {
      if (cause instanceof WorkbenchPersistenceError) throw cause;
      await recordInitializationFailure(
        dependencies.initializationCommitter,
        run,
        startFailure(cause)
      );
      if (isAbortError(cause)) throw cause;
      if (cause instanceof InitializationArtifactVerificationError) throw cause;
      throw new InitializationCapabilityError(run.runId, { cause });
    },
  });
}

function resolveFrozenInitializer(
  setup: ResolvedWorkbenchSetup,
  run: ActiveInitializationRun
): ResolvedInitializerSlot {
  const profile = findResolvedProfile(setup, run.profileId);
  const initializer = profile && findResolvedInitializer(profile, run.initializerId);
  if (
    initializer === undefined ||
    initializer.capability.capabilityId !== run.capabilityId ||
    initializer.runtime.runtimeBindingId !== run.runtimeBindingId ||
    initializer.evidenceDigest !== run.slotEvidenceDigest ||
    (run.status === ModelRunStatus.Running &&
      initializer.runtime.supports.execution.runtimeSupportId !== run.execution.runtimeSupportId)
  ) {
    throw new RunExecutionSupportMismatchError(run.runId);
  }
  return initializer;
}

function parseObservedTerminal(
  initializer: ResolvedInitializerSlot,
  terminal: ExecutionTerminal<JsonValue>
): ExecutionTerminal<InitializationCapabilityResult> {
  if (terminal.status !== ExecutionStatus.Succeeded) return terminal;
  return Object.freeze({
    status: ExecutionStatus.Succeeded,
    result: initializer.capability.parseResult(
      terminal.result,
      'executionSupport.observation.result'
    ),
  });
}

async function rejectObservedCompletion(
  dependencies: InitializationExecutionHandlerDependencies,
  run: RunningInitializationRun,
  cause: unknown
): Promise<never> {
  if (isAbortError(cause)) throw cause;
  if (cause instanceof InitializationArtifactVerificationError) {
    await recordInitializationFailure(
      dependencies.initializationCommitter,
      run,
      observedResultFailure(cause)
    );
    throw cause;
  }
  if (!isProtocolOrCompletionError(cause)) throw cause;
  await recordInitializationFailure(
    dependencies.initializationCommitter,
    run,
    observedResultFailure(cause)
  );
  throw new InitializationCapabilityError(run.runId, { cause });
}

function requireActiveInitializationRun(run: ActiveModelRun): ActiveInitializationRun {
  if (run.operation !== ModelOperationKind.Initialization) {
    throw new RunExecutionSupportMismatchError(run.runId);
  }
  return run;
}

function requireRunningInitializationRun(run: RunningModelRun): RunningInitializationRun {
  if (run.operation !== ModelOperationKind.Initialization) {
    throw new RunExecutionSupportMismatchError(run.runId);
  }
  return run;
}

function isProtocolOrCompletionError(cause: unknown): boolean {
  return cause instanceof InvalidWorkbenchValueError || cause instanceof WorkbenchExtensionError;
}

function observedResultFailure(cause: unknown): ExecutionFailure {
  return parseExecutionFailure({
    code: 'INITIALIZATION_OBSERVED_RESULT_INVALID',
    message: 'Observed Initialization result could not be accepted.',
    retryable: false,
    diagnostics: { cause: cause instanceof Error ? cause.message : 'unknown error' },
  });
}

function startFailure(cause: unknown): ExecutionFailure {
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
