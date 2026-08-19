import {
  cancelModelRun,
  defineModelBase,
  failModelRun,
  loseModelRun,
  ModelOperationKind,
  parseArtifactId,
  parseArtifactReference,
  parseBaseId,
  succeedInitializationRun,
  type ActiveInitializationRun,
  type ArtifactReference,
  type ExecutionFailure,
  type InitializationModelBase,
  type TerminalInitializationRun,
} from '@ta-agent/workbench-domain';
import {
  ExecutionStatus,
  type ExecutionTerminal,
  type InitializationCapabilityResult,
} from '@ta-agent/workbench-extension';
import type { ResolvedInitializerSlot } from '@ta-agent/workbench-setup';
import type { InitializationCommitter } from '@ta-agent/workbench-persistence';

import type { ModelWorkbenchOperationOptions } from '../../execution/contracts.js';
import type { WorkbenchIdSource } from '../../ports/workbench-id-source.js';
import { InitializationArtifactVerificationError } from './errors.js';

export interface CompleteInitializationDependencies {
  readonly initializationCommitter: InitializationCommitter;
  readonly idSource: WorkbenchIdSource;
}

export async function completeInitialization(
  dependencies: CompleteInitializationDependencies,
  run: ActiveInitializationRun,
  initializer: ResolvedInitializerSlot,
  terminal: ExecutionTerminal<InitializationCapabilityResult>,
  options?: ModelWorkbenchOperationOptions
): Promise<TerminalInitializationRun> {
  if (terminal.status === ExecutionStatus.Failed) {
    const failed = failModelRun(run, terminal.failure);
    await dependencies.initializationCommitter.commit({ run: failed });
    return failed;
  }
  if (terminal.status === ExecutionStatus.Cancelled) {
    const cancelled = cancelModelRun(run, terminal.reason);
    await dependencies.initializationCommitter.commit({ run: cancelled });
    return cancelled;
  }
  if (terminal.status === ExecutionStatus.Lost) {
    const lost = loseModelRun(run, terminal.failure);
    await dependencies.initializationCommitter.commit({ run: lost });
    return lost;
  }

  const result = terminal.result;
  const artifactSupport = initializer.runtime.supports.artifactHandoff;
  const artifactId = parseArtifactId(
    dependencies.idSource.nextId('artifact'),
    'generated.artifactId'
  );
  const artifact = parseArtifactReference({
    artifactId,
    digest: result.artifact.digest,
    handoff: {
      runtimeSupportId: artifactSupport.runtimeSupportId,
      receipt: result.artifact.receipt,
    },
  });
  try {
    await artifactSupport.verify(Object.freeze({ artifact }), options);
  } catch (cause: unknown) {
    if (isAbortError(cause)) throw cause;
    throw new InitializationArtifactVerificationError(run.runId, artifactId, {
      cause,
    });
  }
  const baseId = parseBaseId(dependencies.idSource.nextId('base'), 'generated.baseId');
  const base = defineInitializationBase(run, initializer, artifact, baseId);
  const succeeded = succeedInitializationRun(run, baseId, result.data);
  await dependencies.initializationCommitter.commit({ run: succeeded, base });
  return succeeded;
}

export async function recordInitializationFailure(
  initializationCommitter: InitializationCommitter,
  run: ActiveInitializationRun,
  failure: ExecutionFailure
): Promise<void> {
  try {
    await initializationCommitter.commit({ run: failModelRun(run, failure) });
  } catch {
    // The persistence adapter owns reconciliation. Preserve the original execution error.
  }
}

function defineInitializationBase(
  run: ActiveInitializationRun,
  initializer: ResolvedInitializerSlot,
  artifact: ArtifactReference,
  baseId: InitializationModelBase['baseId']
): InitializationModelBase {
  return defineModelBase({
    baseId,
    profileId: run.profileId,
    artifact,
    lineage: {
      kind: ModelOperationKind.Initialization,
      runId: run.runId,
      initializerId: run.initializerId,
      capabilityId: initializer.capability.capabilityId,
      runtimeBindingId: initializer.runtime.runtimeBindingId,
      slotEvidenceDigest: initializer.evidenceDigest,
    },
  });
}

function isAbortError(cause: unknown): boolean {
  return cause instanceof Error && cause.name === 'AbortError';
}
