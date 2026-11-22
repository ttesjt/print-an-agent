import type { BundleWorkflowDefinition } from '@print-an-agent/workflow-core/bundle';
import type {
  MemoryStepName,
  MemoryWorkflowState,
  MemoryOperationOptions as MemoryWorkflowOptions,
} from '../shared/index.js';
import type { ReadMemoryVersionContextInput } from '../../history/index.js';
import type { ReadContextResult } from '../../context/index.js';
import { memoryDefinition } from '../shared/index.js';
import type { VersionedMemoryOperations } from './types/resources.js';

export function createMemoryReadVersionContextDefinition(
  options: MemoryWorkflowOptions<
    ReadMemoryVersionContextInput,
    ReadContextResult | undefined,
    'readVersionContext',
    VersionedMemoryOperations
  > = {}
): BundleWorkflowDefinition<
  MemoryStepName,
  ReadMemoryVersionContextInput,
  MemoryWorkflowState<ReadMemoryVersionContextInput, ReadContextResult | undefined>,
  { readonly memory: Pick<VersionedMemoryOperations, 'readVersionContext'> },
  ReadContextResult | undefined
> {
  return memoryDefinition<
    ReadMemoryVersionContextInput,
    ReadContextResult | undefined,
    'readVersionContext',
    VersionedMemoryOperations
  >(
    'context-memory.read-version-context',
    () => undefined,
    (resources, input, signal) => resources.memory.readVersionContext(input, signal),
    options
  );
}
