import {
  ModelOperationKind,
  ModelRunResultKind,
  ModelRunStatus,
  modelBasesEqual,
  modelModificationsEqual,
  modelRunsEqual,
  modelStatesEqual,
  type ActiveModelRun,
  type ModelBase,
  type ModelModification,
  type ModelRun,
} from '@print-an-agent/workbench-domain';

import { PersistenceRecordConflictError, RunTransitionPersistenceError } from '../errors.js';
import type {
  SucceededTrainingBaseCommit,
  SucceededTrainingModificationCommit,
  TrainingCommit,
  TrainingCommitter,
} from '../ports/training-committer.js';
import type { RecordBackedPersistenceOptions } from './create-record-backed-persistence.js';
import type { PersistenceRecordStore } from './persistence-record-store.js';
import { assertProfileScope } from './profile-scope.js';
import { activeRunCanComplete } from './run-transition.js';

export function createRecordStoreTrainingCommitter(
  store: PersistenceRecordStore,
  options: RecordBackedPersistenceOptions
): TrainingCommitter {
  return Object.freeze({
    commit: (input: TrainingCommit): Promise<void> =>
      Promise.resolve().then(() => {
        assertProfileScope(options.profileId, input.run, 'run', input.run.runId);
        if (isSucceededBaseCommit(input)) {
          assertProfileScope(options.profileId, input.base, 'base', input.base.baseId);
        }
        if (isSucceededModificationCommit(input)) {
          assertProfileScope(
            options.profileId,
            input.modification,
            'modification',
            input.modification.modificationId
          );
        }
        store.transaction(() => commitTraining(store, input));
      }),
  });
}

function commitTraining(store: PersistenceRecordStore, input: TrainingCommit): void {
  const runId = input.run.runId;
  const existingRun = store.runs.find(runId);
  if (existingRun === undefined) {
    throw new RunTransitionPersistenceError(runId, 'must exist before it can complete.');
  }
  if (!isActive(existingRun)) {
    if (commitAlreadyMatches(store, existingRun, input)) return;
    throw new RunTransitionPersistenceError(runId, 'has already reached a terminal state.');
  }
  if (!activeRunCanComplete(existingRun, input.run)) {
    throw new RunTransitionPersistenceError(
      runId,
      'cannot change its frozen operation selection while completing.'
    );
  }

  assertCommitShape(input);
  if (input.run.status === ModelRunStatus.Succeeded) {
    if (isSucceededBaseCommit(input)) {
      assertSucceededBaseCommit(input);
      storeBase(store, input.base);
    } else if (isSucceededModificationCommit(input)) {
      assertSucceededModificationCommit(input);
      storeModification(store, input.modification);
    } else {
      invalidSucceededCommit(runId);
    }
  }
  store.runs.store(runId, input.run);
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

function assertCommitShape(input: TrainingCommit): void {
  const hasBase = 'base' in input;
  const hasModification = 'modification' in input;
  if (input.run.status !== ModelRunStatus.Succeeded) {
    if (hasBase || hasModification) invalidSucceededCommit(input.run.runId);
    return;
  }
  const expectsBase = input.run.result.kind === ModelRunResultKind.Base;
  if (
    hasBase === hasModification ||
    (expectsBase && !hasBase) ||
    (!expectsBase && !hasModification)
  ) {
    invalidSucceededCommit(input.run.runId);
  }
}

function storeBase(store: PersistenceRecordStore, base: ModelBase): void {
  const existing = store.bases.find(base.baseId);
  if (existing !== undefined && !modelBasesEqual(existing, base)) {
    throw new PersistenceRecordConflictError('base', base.baseId);
  }
  store.bases.store(base.baseId, base);
}

function storeModification(store: PersistenceRecordStore, modification: ModelModification): void {
  const existing = store.modifications.find(modification.modificationId);
  if (existing !== undefined && !modelModificationsEqual(existing, modification)) {
    throw new PersistenceRecordConflictError('modification', modification.modificationId);
  }
  store.modifications.store(modification.modificationId, modification);
}

function commitAlreadyMatches(
  store: PersistenceRecordStore,
  storedRun: ModelRun,
  input: TrainingCommit
): boolean {
  const runStatus: ModelRunStatus = input.run.status;
  if (!modelRunsEqual(storedRun, input.run)) return false;
  if (isSucceededBaseCommit(input)) {
    const base = store.bases.find(input.base.baseId);
    return base !== undefined && modelBasesEqual(base, input.base);
  }
  if (isSucceededModificationCommit(input)) {
    const modification = store.modifications.find(input.modification.modificationId);
    return modification !== undefined && modelModificationsEqual(modification, input.modification);
  }
  return runStatus !== ModelRunStatus.Succeeded;
}

function invalidSucceededCommit(runId: string): never {
  throw new RunTransitionPersistenceError(
    runId,
    'must commit the exact parameter asset declared by the succeeded Training Run.'
  );
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
