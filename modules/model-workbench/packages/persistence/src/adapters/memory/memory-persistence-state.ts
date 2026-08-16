import type { BaseId, ModelBase, ModelRun, RunId } from '@ta-agent/workbench-domain';

export interface MemoryPersistenceState {
  readonly runs: Map<RunId, ModelRun>;
  readonly bases: Map<BaseId, ModelBase>;
}

export function createMemoryPersistenceState(): MemoryPersistenceState {
  return {
    runs: new Map<RunId, ModelRun>(),
    bases: new Map<BaseId, ModelBase>(),
  };
}
