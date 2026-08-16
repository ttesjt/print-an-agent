import { createMemoryInitializationCommitter } from './memory-initialization-committer.js';
import { createMemoryParameterRepository } from './memory-parameter-repository.js';
import { createMemoryRunRepository } from './memory-run-repository.js';
import { createMemoryPersistenceState } from './memory-persistence-state.js';

export function createMemoryPersistence() {
  const state = createMemoryPersistenceState();

  return Object.freeze({
    runs: createMemoryRunRepository(state),
    parameters: createMemoryParameterRepository(state),
    commits: Object.freeze({
      initialization: createMemoryInitializationCommitter(state),
    }),
  });
}
