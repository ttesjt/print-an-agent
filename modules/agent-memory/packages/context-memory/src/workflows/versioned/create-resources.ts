import type { MemoryHistoryStore, ReadMemoryVersionContextInput } from '../../history/index.js';
import { readMemoryVersionContext } from '../../history/index.js';
import type { MemoryMutationResources } from '../../mutations/index.js';
import { createContextMemoryResources } from '../deterministic/index.js';
import { createContextMemoryHistoryResources } from '../history/index.js';
import type { VersionedMemoryWorkflowResources } from './types/resources.js';

/** Explicit opt-in. Current-only adapters and management consumers keep their narrow capability. */
export function createVersionedContextMemoryResources(
  options: MemoryMutationResources & { readonly store: MemoryHistoryStore }
): VersionedMemoryWorkflowResources {
  return Object.freeze({
    memory: Object.freeze({
      ...createContextMemoryResources(options).memory,
      ...createContextMemoryHistoryResources(options.store).memory,
      readVersionContext: (input: ReadMemoryVersionContextInput, signal?: AbortSignal) =>
        readMemoryVersionContext(options, input, signal),
    }),
  });
}
