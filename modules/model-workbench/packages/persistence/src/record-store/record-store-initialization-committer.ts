import {
  ModelOperationKind,
  ModelRunStatus,
  modelBasesEqual,
  modelRunsEqual,
  type ActiveModelRun,
  type ModelBase,
  type ModelRun,
} from '@print-an-agent/workbench-domain';

import { PersistenceRecordConflictError, RunTransitionPersistenceError } from '../errors.js';
import type {
  InitializationCommit,
  InitializationCommitter,
  SucceededInitializationCommit,
} from '../ports/initialization-committer.js';
import type { RecordBackedPersistenceOptions } from './create-record-backed-persistence.js';
import type { PersistenceRecordStore } from './persistence-record-store.js';
import { assertProfileScope } from './profile-scope.js';
import { activeRunCanComplete } from './run-transition.js';

export function createRecordStoreInitializationCommitter(
  store: PersistenceRecordStore,
  options: RecordBackedPersistenceOptions
): InitializationCommitter {
  return Object.freeze({
    commit: (input: InitializationCommit): Promise<void> =>
      Promise.resolve().then(() => {
        assertProfileScope(options.profileId, input.run, 'run', input.run.runId);
        if (isSucceededCommit(input)) {
          assertProfileScope(options.profileId, input.base, 'base', input.base.baseId);
        }
        store.transaction(() => commitInitialization(store, input));
      }),
  });
}

function commitInitialization(store: PersistenceRecordStore, input: InitializationCommit): void {
  assertCommitShape(input);
  const existingRun = store.runs.find(input.run.runId);
  if (existingRun === undefined) {
    throw new RunTransitionPersistenceError(input.run.runId, 'must exist before it can complete.');
  }
  if (!isActive(existingRun)) {
    if (commitAlreadyMatches(store, existingRun, input)) return;
    throw new RunTransitionPersistenceError(
      input.run.runId,
      'has already reached a terminal state.'
    );
  }
  if (!activeRunCanComplete(existingRun, input.run)) {
    throw new RunTransitionPersistenceError(
      input.run.runId,
      'cannot change its frozen operation selection while completing.'
    );
  }
  if (isSucceededCommit(input)) {
    assertSucceededCommit(input);
    storeBase(store, input.base);
  }
  store.runs.store(input.run.runId, input.run);
}

function assertCommitShape(input: InitializationCommit): void {
  const hasBase = 'base' in input;
  if (
    (input.run.status === ModelRunStatus.Succeeded && !hasBase) ||
    (input.run.status !== ModelRunStatus.Succeeded && hasBase)
  ) {
    throw new RunTransitionPersistenceError(
      input.run.runId,
      'must commit a Base if and only if the Initialization Run succeeded.'
    );
  }
}

function assertSucceededCommit(input: SucceededInitializationCommit): void {
  const lineage = input.base.lineage;
  if (
    input.base.baseId !== input.run.result.baseId ||
    input.base.profileId !== input.run.profileId ||
    lineage.kind !== ModelOperationKind.Initialization ||
    lineage.runId !== input.run.runId ||
    lineage.initializerId !== input.run.initializerId ||
    lineage.capabilityId !== input.run.capabilityId ||
    lineage.runtimeBindingId !== input.run.runtimeBindingId ||
    lineage.slotEvidenceDigest !== input.run.slotEvidenceDigest
  ) {
    throw new RunTransitionPersistenceError(
      input.run.runId,
      'must commit the exact Base declared by the succeeded Run.'
    );
  }
}

function storeBase(store: PersistenceRecordStore, base: ModelBase): void {
  const existing = store.bases.find(base.baseId);
  if (existing !== undefined && !modelBasesEqual(existing, base)) {
    throw new PersistenceRecordConflictError('base', base.baseId);
  }
  store.bases.store(base.baseId, base);
}

function commitAlreadyMatches(
  store: PersistenceRecordStore,
  storedRun: ModelRun,
  input: InitializationCommit
): boolean {
  if (!modelRunsEqual(storedRun, input.run)) return false;
  if (!isSucceededCommit(input)) return true;
  const storedBase = store.bases.find(input.base.baseId);
  return storedBase !== undefined && modelBasesEqual(storedBase, input.base);
}

function isActive(run: ModelRun): run is ActiveModelRun {
  return run.status === ModelRunStatus.Starting || run.status === ModelRunStatus.Running;
}

function isSucceededCommit(input: InitializationCommit): input is SucceededInitializationCommit {
  return input.run.status === ModelRunStatus.Succeeded && 'base' in input;
}
