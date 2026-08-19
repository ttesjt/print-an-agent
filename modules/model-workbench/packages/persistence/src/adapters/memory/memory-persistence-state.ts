import type {
  BaseId,
  ModelBase,
  ModelModification,
  ModelRun,
  ModificationId,
  RunId,
} from '@ta-agent/workbench-domain';

export interface MemoryPersistenceState {
  readonly runs: Map<RunId, ModelRun>;
  readonly bases: Map<BaseId, ModelBase>;
  readonly modifications: Map<ModificationId, ModelModification>;
}

export function createMemoryPersistenceState(): MemoryPersistenceState {
  return {
    runs: new Map<RunId, ModelRun>(),
    bases: new Map<BaseId, ModelBase>(),
    modifications: new Map<ModificationId, ModelModification>(),
  };
}
