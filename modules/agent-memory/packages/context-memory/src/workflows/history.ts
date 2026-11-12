import { WorkflowBundle } from '@print-an-agent/workflow-bundle';
import type { MemorySnapshot } from '../contracts/document.js';
import type {
  ForkMemoryInput,
  ListMemoryVersionsInput,
  MemoryHistoryPage,
  MemoryHistoryStore,
  MemoryVersionReference,
} from '../contracts/history.js';
import type { MutationResult } from '../contracts/receipt.js';
import { inspectMemoryVersion, listMemoryVersions, forkMemory } from '../domain/history.js';
import { memoryDefinition, type MemoryWorkflowOptions } from './definition.js';
import { createContextMemoryStateResources } from './state-resources.js';
import { createMemoryGetReceiptDefinition } from './deterministic.js';
import type { MemoryOperations } from './resources.js';

export interface MemoryHistoryOperations extends Pick<MemoryOperations, 'getReceipt'> {
  inspectVersion(input: MemoryVersionReference, signal?: AbortSignal): Promise<MemorySnapshot>;
  listVersions(input: ListMemoryVersionsInput, signal?: AbortSignal): Promise<MemoryHistoryPage>;
  fork(input: ForkMemoryInput, signal?: AbortSignal): Promise<MutationResult>;
}
export interface MemoryHistoryWorkflowResources {
  readonly memory: MemoryHistoryOperations;
}
export function createContextMemoryHistoryResources(
  store: MemoryHistoryStore
): MemoryHistoryWorkflowResources {
  return Object.freeze({
    memory: Object.freeze({
      getReceipt: createContextMemoryStateResources(store).memory.getReceipt,
      inspectVersion: (input: MemoryVersionReference, signal?: AbortSignal) =>
        inspectMemoryVersion(store, input, signal),
      listVersions: (input: ListMemoryVersionsInput, signal?: AbortSignal) =>
        listMemoryVersions(store, input, signal),
      fork: (input: ForkMemoryInput, signal?: AbortSignal) => forkMemory(store, input, signal),
    }),
  });
}
export function createMemoryInspectVersionDefinition(
  options: MemoryWorkflowOptions<
    MemoryVersionReference,
    MemorySnapshot | undefined,
    'inspectVersion',
    MemoryHistoryOperations
  > = {}
) {
  return memoryDefinition<
    MemoryVersionReference,
    MemorySnapshot | undefined,
    'inspectVersion',
    MemoryHistoryOperations
  >(
    'context-memory.inspect-version',
    () => undefined,
    (resources, input, signal) => resources.memory.inspectVersion(input, signal),
    options
  );
}
export function createMemoryListVersionsDefinition(
  options: MemoryWorkflowOptions<
    ListMemoryVersionsInput,
    MemoryHistoryPage | undefined,
    'listVersions',
    MemoryHistoryOperations
  > = {}
) {
  return memoryDefinition<
    ListMemoryVersionsInput,
    MemoryHistoryPage | undefined,
    'listVersions',
    MemoryHistoryOperations
  >(
    'context-memory.list-versions',
    () => undefined,
    (resources, input, signal) => resources.memory.listVersions(input, signal),
    options
  );
}
export function createMemoryForkDefinition(
  options: MemoryWorkflowOptions<
    ForkMemoryInput,
    MutationResult,
    'fork',
    MemoryHistoryOperations
  > = {}
) {
  return memoryDefinition<ForkMemoryInput, MutationResult, 'fork', MemoryHistoryOperations>(
    'context-memory.fork',
    () => ({ status: 'skipped', reason: 'workflow-not-executed' }),
    (resources, input, signal) => resources.memory.fork(input, signal),
    options,
    true
  );
}
export function memoryHistoryDefinitions() {
  return {
    inspectVersion: createMemoryInspectVersionDefinition(),
    listVersions: createMemoryListVersionsDefinition(),
    fork: createMemoryForkDefinition(),
  };
}
export type MemoryHistoryWorkflowDefinitions = ReturnType<typeof memoryHistoryDefinitions>;
/** Narrow state-only installation: history and fork need no model, counter or renderer. */
export function createContextMemoryHistoryBundle(options: {
  readonly resources: MemoryHistoryWorkflowResources;
  readonly workflows?: Partial<
    MemoryHistoryWorkflowDefinitions & {
      readonly getReceipt: ReturnType<typeof createMemoryGetReceiptDefinition>;
    }
  >;
}) {
  return new WorkflowBundle({
    resources: options.resources,
    workflows: {
      ...memoryHistoryDefinitions(),
      getReceipt: createMemoryGetReceiptDefinition(),
      ...options.workflows,
    },
  });
}
