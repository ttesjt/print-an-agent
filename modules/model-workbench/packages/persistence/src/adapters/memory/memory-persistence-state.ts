import type {
  BaseId,
  ModelBase,
  ModelModification,
  ModelOutput,
  ModelRun,
  ModificationId,
  OutputId,
  RunId,
} from '@ta-agent/workbench-domain';

export interface MemoryPersistenceState {
  readonly runs: Map<RunId, ModelRun>;
  readonly bases: Map<BaseId, ModelBase>;
  readonly modifications: Map<ModificationId, ModelModification>;
  readonly outputs: Map<OutputId, ModelOutput>;
}

export function createMemoryPersistenceState(): MemoryPersistenceState {
  return {
    runs: new Map<RunId, ModelRun>(),
    bases: new Map<BaseId, ModelBase>(),
    modifications: new Map<ModificationId, ModelModification>(),
    outputs: new Map<OutputId, ModelOutput>(),
  };
}
