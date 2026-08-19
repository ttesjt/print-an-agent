import {
  ModelRunStatus,
  modelRunsEqual,
  type ActiveModelRun,
  type ModelRun,
  type RunId,
  type StartingModelRun,
} from '@ta-agent/workbench-domain';

import { PersistenceRecordConflictError } from '../../errors.js';
import type { RunRepository } from '../../ports/run-repository.js';
import type { MemoryPersistenceState } from './memory-persistence-state.js';

export function createMemoryRunRepository(state: MemoryPersistenceState): RunRepository {
  return Object.freeze({
    create: (run: StartingModelRun): Promise<void> => {
      const existing = state.runs.get(run.runId);
      if (existing !== undefined) {
        if (modelRunsEqual(existing, run)) return Promise.resolve();
        return Promise.reject(new PersistenceRecordConflictError('run', run.runId));
      }
      state.runs.set(run.runId, run);
      return Promise.resolve();
    },
    updateActive: (run: ActiveModelRun): Promise<void> => {
      const existing = state.runs.get(run.runId);
      if (existing === undefined) {
        return Promise.reject(new PersistenceRecordConflictError('run', run.runId));
      }
      if (modelRunsEqual(existing, run)) return Promise.resolve();
      if (!isValidActiveTransition(existing, run)) {
        return Promise.reject(new PersistenceRecordConflictError('run', run.runId));
      }
      state.runs.set(run.runId, run);
      return Promise.resolve();
    },
    find: (runId: RunId): Promise<ModelRun | undefined> => Promise.resolve(state.runs.get(runId)),
  });
}

function sameFrozenRun(left: ModelRun, right: ModelRun): boolean {
  return (
    left.operation === right.operation &&
    left.profileId === right.profileId &&
    left.initializerId === right.initializerId &&
    left.capabilityId === right.capabilityId &&
    left.runtimeBindingId === right.runtimeBindingId &&
    left.slotEvidenceDigest === right.slotEvidenceDigest
  );
}

function isValidActiveTransition(existing: ModelRun, next: ActiveModelRun): boolean {
  if (!sameFrozenRun(existing, next)) return false;
  if (existing.status === ModelRunStatus.Starting) {
    return next.status === ModelRunStatus.Running;
  }
  if (existing.status !== ModelRunStatus.Running || next.status !== ModelRunStatus.Running) {
    return false;
  }
  return JSON.stringify(existing.execution) === JSON.stringify(next.execution);
}
