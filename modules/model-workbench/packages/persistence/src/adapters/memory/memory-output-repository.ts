import type { ModelOutput, OutputId } from '@ta-agent/workbench-domain';

import type { OutputRepository } from '../../ports/output-repository.js';
import type { MemoryPersistenceState } from './memory-persistence-state.js';

export function createMemoryOutputRepository(state: MemoryPersistenceState): OutputRepository {
  return Object.freeze({
    findOutput: (outputId: OutputId): Promise<ModelOutput | undefined> =>
      Promise.resolve(state.outputs.get(outputId)),
  });
}
