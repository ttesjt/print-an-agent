import {
  modelRunsEqual,
  type ModelRun,
  type RunId,
  type RunningModelRun,
} from '@ta-agent/workbench-domain';

import { PersistenceRecordConflictError } from '../../errors.js';
import type { RunRepository } from '../../ports/run-repository.js';
import type { MemoryPersistenceState } from './memory-persistence-state.js';

export function createMemoryRunRepository(state: MemoryPersistenceState): RunRepository {
  return Object.freeze({
    create: (run: RunningModelRun): Promise<void> => {
      const existing = state.runs.get(run.runId);
      if (existing !== undefined) {
        if (modelRunsEqual(existing, run)) return Promise.resolve();
        return Promise.reject(new PersistenceRecordConflictError('run', run.runId));
      }
      state.runs.set(run.runId, run);
      return Promise.resolve();
    },
    find: (runId: RunId): Promise<ModelRun | undefined> => Promise.resolve(state.runs.get(runId)),
  });
}
