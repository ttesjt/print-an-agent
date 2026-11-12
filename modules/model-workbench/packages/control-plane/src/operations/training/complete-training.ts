import {
  cancelModelRun,
  defineModelBase,
  defineModelModification,
  failModelRun,
  loseModelRun,
  ModelOperationKind,
  ModelRunResultKind,
  parseArtifactId,
  parseArtifactReference,
  parseBaseId,
  parseModificationId,
  succeedTrainingRun,
  type ActiveTrainingRun,
  type ArtifactReference,
  type ExecutionFailure,
  type TerminalTrainingRun,
  type TrainingLineage,
  type TrainingModelBase,
} from '@print-an-agent/workbench-domain';
import {
  ExecutionStatus,
  type ExecutionTerminal,
  type TrainingCapabilityResult,
} from '@print-an-agent/workbench-extension';
import type { TrainingCommitter } from '@print-an-agent/workbench-persistence';
import type { ResolvedTrainerSlot } from '@print-an-agent/workbench-setup';

import { TrainingArtifactVerificationError } from './errors.js';
import type { ModelWorkbenchOperationOptions } from '../../execution/contracts.js';
import type { WorkbenchIdSource } from '../../ports/workbench-id-source.js';
import { readWorkbenchClock, type WorkbenchClock } from '../../ports/workbench-clock.js';

export interface CompleteTrainingDependencies {
  readonly trainingCommitter: TrainingCommitter;
  readonly idSource: WorkbenchIdSource;
  readonly clock: WorkbenchClock;
}

export async function completeTraining(
  dependencies: CompleteTrainingDependencies,
  run: ActiveTrainingRun,
  trainer: ResolvedTrainerSlot,
  terminal: ExecutionTerminal<TrainingCapabilityResult>,
  options?: ModelWorkbenchOperationOptions
): Promise<TerminalTrainingRun> {
  const terminalRecordedAt = readWorkbenchClock(dependencies.clock, 'clock.terminalRecordedAt');
  if (terminal.status === ExecutionStatus.Failed) {
    const failed = failModelRun(run, terminal.failure, terminalRecordedAt);
    await dependencies.trainingCommitter.commit({ run: failed });
    return failed;
  }
  if (terminal.status === ExecutionStatus.Cancelled) {
    const cancelled = cancelModelRun(run, terminalRecordedAt, terminal.reason);
    await dependencies.trainingCommitter.commit({ run: cancelled });
    return cancelled;
  }
  if (terminal.status === ExecutionStatus.Lost) {
    const lost = loseModelRun(run, terminal.failure, terminalRecordedAt);
    await dependencies.trainingCommitter.commit({ run: lost });
    return lost;
  }

  const artifact = await acceptArtifact(dependencies, run, trainer, terminal.result, options);
  const lineage = defineTrainingLineage(run);
  if (terminal.result.assetKind === ModelRunResultKind.Base) {
    const baseId = parseBaseId(dependencies.idSource.nextId('base'), 'generated.baseId');
    const base: TrainingModelBase = defineModelBase({
      baseId,
      profileId: run.profileId,
      artifact,
      lineage,
    });
    const succeeded = succeedTrainingRun(
      run,
      Object.freeze({ kind: ModelRunResultKind.Base, baseId }),
      terminalRecordedAt,
      terminal.result.data
    );
    await dependencies.trainingCommitter.commit({ run: succeeded, base });
    return succeeded;
  }

  const modificationId = parseModificationId(
    dependencies.idSource.nextId('modification'),
    'generated.modificationId'
  );
  const modification = defineModelModification({
    modificationId,
    profileId: run.profileId,
    artifact,
    lineage,
  });
  const succeeded = succeedTrainingRun(
    run,
    Object.freeze({ kind: ModelRunResultKind.Modification, modificationId }),
    terminalRecordedAt,
    terminal.result.data
  );
  await dependencies.trainingCommitter.commit({ run: succeeded, modification });
  return succeeded;
}

export async function recordTrainingFailure(
  dependencies: Pick<CompleteTrainingDependencies, 'trainingCommitter' | 'clock'>,
  run: ActiveTrainingRun,
  failure: ExecutionFailure
): Promise<void> {
  try {
    await dependencies.trainingCommitter.commit({
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

async function acceptArtifact(
  dependencies: CompleteTrainingDependencies,
  run: ActiveTrainingRun,
  trainer: ResolvedTrainerSlot,
  result: TrainingCapabilityResult,
  options?: ModelWorkbenchOperationOptions
): Promise<ArtifactReference> {
  const artifactId = parseArtifactId(
    dependencies.idSource.nextId('artifact'),
    'generated.artifactId'
  );
  const support = trainer.runtime.supports.artifactHandoff;
  const artifact = parseArtifactReference({
    artifactId,
    digest: result.artifact.digest,
    handoff: {
      runtimeSupportId: support.runtimeSupportId,
      receipt: result.artifact.receipt,
    },
  });
  try {
    await support.verify(Object.freeze({ profileId: run.profileId, artifact }), options);
    return artifact;
  } catch (cause: unknown) {
    if (isAbortError(cause)) throw cause;
    throw new TrainingArtifactVerificationError(run.runId, artifactId, { cause });
  }
}

function defineTrainingLineage(run: ActiveTrainingRun): TrainingLineage {
  return Object.freeze({
    kind: ModelOperationKind.Training,
    runId: run.runId,
    trainerId: run.trainerId,
    capabilityId: run.capabilityId,
    runtimeBindingId: run.runtimeBindingId,
    slotEvidenceDigest: run.slotEvidenceDigest,
    source: run.source,
  });
}

function isAbortError(cause: unknown): boolean {
  return cause instanceof Error && cause.name === 'AbortError';
}
