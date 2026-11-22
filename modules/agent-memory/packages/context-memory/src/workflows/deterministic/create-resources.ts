import type { ReadContextInput } from '../../context/index.js';
import { MemoryMutations } from '../../mutations/index.js';
import type { MemoryMutationResources } from '../../mutations/index.js';
import { readMemoryContext } from '../../context/index.js';
import { createContextMemoryStateResources } from '../state/index.js';
import type { MemoryWorkflowResources } from './types/resources.js';

/** Borrow capabilities, never acquire connections or grant Workflows a raw store writer. */
export function createContextMemoryResources(
  options: MemoryMutationResources
): MemoryWorkflowResources {
  const mutations = new MemoryMutations(options);
  return Object.freeze({
    memory: Object.freeze({
      ...createContextMemoryStateResources(options.store).memory,
      create: mutations.create.bind(mutations),
      apply: mutations.apply.bind(mutations),
      configure: mutations.configure.bind(mutations),
      readContext: (input: ReadContextInput, signal?: AbortSignal) =>
        readMemoryContext(options, input, signal),
    }),
  });
}
