import type {
  ForkMemoryInput,
  ListMemoryVersionsInput,
  MemoryHistoryStore,
  MemoryVersionReference,
} from '../../history/index.js';
import { inspectMemoryVersion, listMemoryVersions, forkMemory } from '../../history/index.js';
import { createContextMemoryStateResources } from '../state/index.js';
import type { MemoryHistoryWorkflowResources } from './types/operations.js';

export function createContextMemoryHistoryResources(
  store: MemoryHistoryStore
): MemoryHistoryWorkflowResources {
  const memory = createContextMemoryStateResources(store).memory;
  return Object.freeze({
    memory: Object.freeze({
      getReceipt: memory.getReceipt.bind(memory),
      inspectVersion: (input: MemoryVersionReference, signal?: AbortSignal) =>
        inspectMemoryVersion(store, input, signal),
      listVersions: (input: ListMemoryVersionsInput, signal?: AbortSignal) =>
        listMemoryVersions(store, input, signal),
      fork: (input: ForkMemoryInput, signal?: AbortSignal) => forkMemory(store, input, signal),
    }),
  });
}
