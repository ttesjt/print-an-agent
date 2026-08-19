import {
  ModelOperationKind,
  ModelRunResultKind,
  ModelRunStatus,
  modelBasesEqual,
  modelModificationsEqual,
  modelRunDefinitionsEqual,
  modelRunsEqual,
  modelStatesEqual,
  type ActiveModelRun,
  type ModelBase,
  type ModelModification,
  type ModelRun,
} from '@ta-agent/workbench-domain';

import { PersistenceRecordConflictError, RunTransitionPersistenceError } from '../../errors.js';
import type {
  SucceededTrainingBaseCommit,
  SucceededTrainingModificationCommit,
  TrainingCommit,
  TrainingCommitter,
} from '../../ports/training-committer.js';
import type { MemoryPersistenceState } from './memory-persistence-state.js';

export function createMemoryTrainingCommitter(state: MemoryPersistenceState): TrainingCommitter {
  return Object.freeze({
    commit: (input: TrainingCommit): Promise<void> =>
      Promise.resolve().then(() => commitTraining(state, input)),
  });
}

function commitTraining(state: MemoryPersistenceState, input: TrainingCommit): void {
  const runId = input.run.runId;
  const existingRun = state.runs.get(runId);
  if (existingRun === undefined) {
    throw new RunTransitionPersistenceError(input.run.runId, 'must exist before it can complete.');
  }
  if (!isActive(existingRun)) {
    if (commitAlreadyMatches(state, existingRun, input)) return;
    throw new RunTransitionPersistenceError(
      input.run.runId,
      'has already reached a terminal state.'
    );
  }
  if (!modelRunDefinitionsEqual(existingRun, input.run)) {
    throw new RunTransitionPersistenceError(
      input.run.runId,
      'cannot change its frozen operation selection while completing.'
    );
  }

  assertCommitShape(input);
  if (input.run.status === ModelRunStatus.Succeeded) {
    if (isSucceededBaseCommit(input)) {
      assertSucceededBaseCommit(input);
      storeBase(state, input.base);
    } else if (isSucceededModificationCommit(input)) {
      assertSucceededModificationCommit(input);
      storeModification(state, input.modification);
    } else {
      invalidSucceededCommit(runId);
    }
  }
  state.runs.set(input.run.runId, input.run);
}

function assertSucceededBaseCommit(input: SucceededTrainingBaseCommit): void {
  if (
    input.base.baseId !== input.run.result.baseId ||
    input.base.profileId !== input.run.profileId ||
    !lineageMatchesRun(input.base.lineage, input.run)
  ) {
    invalidSucceededCommit(input.run.runId);
  }
}

function assertSucceededModificationCommit(input: SucceededTrainingModificationCommit): void {
  if (
    input.modification.modificationId !== input.run.result.modificationId ||
    input.modification.profileId !== input.run.profileId ||
    !lineageMatchesRun(input.modification.lineage, input.run)
  ) {
    invalidSucceededCommit(input.run.runId);
  }
}

function assertCommitShape(input: TrainingCommit): void {
  const runId = input.run.runId;
  const hasBase = 'base' in input;
  const hasModification = 'modification' in input;
  if (input.run.status !== ModelRunStatus.Succeeded) {
    if (hasBase || hasModification) invalidSucceededCommit(runId);
    return;
  }
  const expectsBase = input.run.result.kind === ModelRunResultKind.Base;
  if (
    hasBase === hasModification ||
    (expectsBase && !hasBase) ||
    (!expectsBase && !hasModification)
  ) {
    invalidSucceededCommit(runId);
  }
}

function lineageMatchesRun(
  lineage: SucceededTrainingBaseCommit['base']['lineage'],
  run: SucceededTrainingBaseCommit['run'] | SucceededTrainingModificationCommit['run']
): boolean {
  return (
    lineage.kind === ModelOperationKind.Training &&
    lineage.runId === run.runId &&
    lineage.trainerId === run.trainerId &&
    lineage.capabilityId === run.capabilityId &&
    lineage.runtimeBindingId === run.runtimeBindingId &&
    lineage.slotEvidenceDigest === run.slotEvidenceDigest &&
    modelStatesEqual(lineage.source, run.source)
  );
}

function invalidSucceededCommit(runId: string): never {
  throw new RunTransitionPersistenceError(
    runId,
    'must commit the exact parameter asset declared by the succeeded Training Run.'
  );
}

function storeBase(state: MemoryPersistenceState, base: ModelBase): void {
  const existing = state.bases.get(base.baseId);
  if (existing !== undefined && !modelBasesEqual(existing, base)) {
    throw new PersistenceRecordConflictError('base', base.baseId);
  }
  state.bases.set(base.baseId, base);
}

function storeModification(state: MemoryPersistenceState, modification: ModelModification): void {
  const existing = state.modifications.get(modification.modificationId);
  if (existing !== undefined && !modelModificationsEqual(existing, modification)) {
    throw new PersistenceRecordConflictError('modification', modification.modificationId);
  }
  state.modifications.set(modification.modificationId, modification);
}

function commitAlreadyMatches(
  state: MemoryPersistenceState,
  storedRun: ModelRun,
  input: TrainingCommit
): boolean {
  if (!modelRunsEqual(storedRun, input.run)) return false;
  if (input.run.status === ModelRunStatus.Succeeded) {
    if (isSucceededBaseCommit(input)) {
      const base = state.bases.get(input.base.baseId);
      return base !== undefined && modelBasesEqual(base, input.base);
    }
    if (isSucceededModificationCommit(input)) {
      const modification = state.modifications.get(input.modification.modificationId);
      return (
        modification !== undefined && modelModificationsEqual(modification, input.modification)
      );
    }
    return false;
  }
  return true;
}

function isActive(run: ModelRun): run is ActiveModelRun {
  return run.status === ModelRunStatus.Starting || run.status === ModelRunStatus.Running;
}

function isSucceededBaseCommit(input: TrainingCommit): input is SucceededTrainingBaseCommit {
  return (
    input.run.status === ModelRunStatus.Succeeded &&
    input.run.result.kind === ModelRunResultKind.Base &&
    'base' in input &&
    !('modification' in input)
  );
}

function isSucceededModificationCommit(
  input: TrainingCommit
): input is SucceededTrainingModificationCommit {
  return (
    input.run.status === ModelRunStatus.Succeeded &&
    input.run.result.kind === ModelRunResultKind.Modification &&
    'modification' in input &&
    !('base' in input)
  );
}
