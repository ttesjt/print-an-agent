import type { BundleWorkflowDefinition } from '@print-an-agent/workflow-core/bundle';
import type {
  MemoryStepName,
  MemoryWorkflowState,
  MemoryOperationOptions as MemoryWorkflowOptions,
} from '../shared/index.js';
import type { MemorySnapshot } from '../../types/document.js';
import type {
  ForkMemoryInput,
  ListMemoryVersionsInput,
  MemoryHistoryPage,
  MemoryVersionReference,
} from '../../history/index.js';
import type { MutationResult } from '../../types/receipt.js';
import { memoryDefinition } from '../shared/index.js';
import type { MemoryHistoryOperations } from './types/operations.js';

export function createMemoryInspectVersionDefinition(
  options: MemoryWorkflowOptions<
    MemoryVersionReference,
    MemorySnapshot | undefined,
    'inspectVersion',
    MemoryHistoryOperations
  > = {}
): BundleWorkflowDefinition<
  MemoryStepName,
  MemoryVersionReference,
  MemoryWorkflowState<MemoryVersionReference, MemorySnapshot | undefined>,
  { readonly memory: Pick<MemoryHistoryOperations, 'inspectVersion'> },
  MemorySnapshot | undefined
> {
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
): BundleWorkflowDefinition<
  MemoryStepName,
  ListMemoryVersionsInput,
  MemoryWorkflowState<ListMemoryVersionsInput, MemoryHistoryPage | undefined>,
  { readonly memory: Pick<MemoryHistoryOperations, 'listVersions'> },
  MemoryHistoryPage | undefined
> {
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
): BundleWorkflowDefinition<
  MemoryStepName,
  ForkMemoryInput,
  MemoryWorkflowState<ForkMemoryInput, MutationResult>,
  { readonly memory: Pick<MemoryHistoryOperations, 'fork'> },
  MutationResult
> {
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
