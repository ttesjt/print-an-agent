import {
  ModelRunStatus,
  modelRunDefinitionsEqual,
  modelRunsEqual,
  type ActiveModelRun,
  type ModelRun,
  type RunId,
  type StartingModelRun,
} from '@print-an-agent/workbench-domain';

import { PersistenceRecordConflictError } from '../errors.js';
import type { RunRepository } from '../ports/run-repository.js';
import type { PersistencePageRequest } from '../ports/persistence-page.js';
import type { RecordBackedPersistenceOptions } from './create-record-backed-persistence.js';
import type { PersistenceRecordStore } from './persistence-record-store.js';
import { assertProfileScope } from './profile-scope.js';

export function createRecordStoreRunRepository(
  store: PersistenceRecordStore,
  options: RecordBackedPersistenceOptions
): RunRepository {
  return Object.freeze({
    create: (run: StartingModelRun): Promise<void> =>
      Promise.resolve().then(() => {
        assertProfileScope(options.profileId, run, 'run', run.runId);
        store.transaction(() => createRun(store, run));
      }),
    updateActive: (run: ActiveModelRun): Promise<void> =>
      Promise.resolve().then(() => {
        assertProfileScope(options.profileId, run, 'run', run.runId);
        store.transaction(() => updateActiveRun(store, run));
      }),
    find: (runId: RunId): Promise<ModelRun | undefined> =>
      Promise.resolve().then(() => store.runs.find(runId)),
    list: (request: PersistencePageRequest<RunId>) =>
      Promise.resolve().then(() => store.runs.list(request)),
  });
}

function createRun(store: PersistenceRecordStore, run: StartingModelRun): void {
  const existing = store.runs.find(run.runId);
  if (existing !== undefined) {
    if (modelRunsEqual(existing, run)) return;
    throw new PersistenceRecordConflictError('run', run.runId);
  }
  store.runs.store(run.runId, run);
}

function updateActiveRun(store: PersistenceRecordStore, run: ActiveModelRun): void {
  const existing = store.runs.find(run.runId);
  if (existing === undefined) throw new PersistenceRecordConflictError('run', run.runId);
  if (modelRunsEqual(existing, run)) return;
  if (!isValidActiveTransition(existing, run)) {
    throw new PersistenceRecordConflictError('run', run.runId);
  }
  store.runs.store(run.runId, run);
}

function isValidActiveTransition(existing: ModelRun, next: ActiveModelRun): boolean {
  if (!modelRunDefinitionsEqual(existing, next)) return false;
  if (existing.status === ModelRunStatus.Starting) {
    if (next.status === ModelRunStatus.Starting) {
      return existing.dispatchedAt === undefined && next.dispatchedAt !== undefined;
    }
    return (
      next.status === ModelRunStatus.Running &&
      (existing.dispatchedAt === undefined || existing.dispatchedAt === next.dispatchedAt)
    );
  }
  if (existing.status !== ModelRunStatus.Running || next.status !== ModelRunStatus.Running) {
    return false;
  }
  return (
    existing.dispatchedAt === next.dispatchedAt &&
    JSON.stringify(existing.execution) === JSON.stringify(next.execution)
  );
}
