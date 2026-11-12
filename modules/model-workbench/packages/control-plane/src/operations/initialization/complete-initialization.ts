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
} from '@print-an-agent/workbench-domain';
import {
  ExecutionStatus,
  type ExecutionTerminal,
  type InitializationCapabilityResult,
} from '@print-an-agent/workbench-extension';
import type { ResolvedInitializerSlot } from '@print-an-agent/workbench-setup';
import type { InitializationCommitter } from '@print-an-agent/workbench-persistence';

import type { ModelWorkbenchOperationOptions } from '../../execution/contracts.js';
import type { WorkbenchIdSource } from '../../ports/workbench-id-source.js';
import { readWorkbenchClock, type WorkbenchClock } from '../../ports/workbench-clock.js';
import { InitializationArtifactVerificationError } from './errors.js';

export interface CompleteInitializationDependencies {
  readonly initializationCommitter: InitializationCommitter;
  readonly idSource: WorkbenchIdSource;
  readonly clock: WorkbenchClock;
}

export async function completeInitialization(
  dependencies: CompleteInitializationDependencies,
  run: ActiveInitializationRun,
  initializer: ResolvedInitializerSlot,
  terminal: ExecutionTerminal<InitializationCapabilityResult>,
  options?: ModelWorkbenchOperationOptions
): Promise<TerminalInitializationRun> {
  const terminalRecordedAt = readWorkbenchClock(dependencies.clock, 'clock.terminalRecordedAt');
  if (terminal.status === ExecutionStatus.Failed) {
    const failed = failModelRun(run, terminal.failure, terminalRecordedAt);
    await dependencies.initializationCommitter.commit({ run: failed });
    return failed;
  }
  if (terminal.status === ExecutionStatus.Cancelled) {
    const cancelled = cancelModelRun(run, terminalRecordedAt, terminal.reason);
    await dependencies.initializationCommitter.commit({ run: cancelled });
    return cancelled;
  }
  if (terminal.status === ExecutionStatus.Lost) {
    const lost = loseModelRun(run, terminal.failure, terminalRecordedAt);
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
    await artifactSupport.verify(Object.freeze({ profileId: run.profileId, artifact }), options);
  } catch (cause: unknown) {
    if (isAbortError(cause)) throw cause;
    throw new InitializationArtifactVerificationError(run.runId, artifactId, {
      cause,
    });
  }
  const baseId = parseBaseId(dependencies.idSource.nextId('base'), 'generated.baseId');
  const base = defineInitializationBase(run, initializer, artifact, baseId);
  const succeeded = succeedInitializationRun(run, baseId, terminalRecordedAt, result.data);
  await dependencies.initializationCommitter.commit({ run: succeeded, base });
  return succeeded;
}

export async function recordInitializationFailure(
  dependencies: Pick<CompleteInitializationDependencies, 'initializationCommitter' | 'clock'>,
  run: ActiveInitializationRun,
  failure: ExecutionFailure
): Promise<void> {
  try {
    await dependencies.initializationCommitter.commit({
      run: failModelRun(
        run,
        failure,
        readWorkbenchClock(dependencies.clock, 'clock.terminalRecordedAt')
      ),
    });
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
