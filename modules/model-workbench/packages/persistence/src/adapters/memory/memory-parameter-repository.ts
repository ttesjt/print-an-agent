import type { BaseId, ModelBase } from '@ta-agent/workbench-domain';

import type { ParameterRepository } from '../../ports/parameter-repository.js';
import type { MemoryPersistenceState } from './memory-persistence-state.js';

export function createMemoryParameterRepository(
  state: MemoryPersistenceState
): ParameterRepository {
  return Object.freeze({
    findBase: (baseId: BaseId): Promise<ModelBase | undefined> =>
      Promise.resolve(state.bases.get(baseId)),
  });
}
