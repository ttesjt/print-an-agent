import type { ReadMemoryVersionContextInput } from '../../history/index.js';
import type { ReadContextResult } from '../../context/index.js';
import { memoryDefinition } from '../definition.js';
import type { MemoryWorkflowOptions } from '../deterministic/types/workflow.js';
import type { VersionedMemoryOperations } from './types/resources.js';

export function createMemoryReadVersionContextDefinition(
  options: MemoryWorkflowOptions<
    ReadMemoryVersionContextInput,
    ReadContextResult | undefined,
    'readVersionContext',
    VersionedMemoryOperations
  > = {}
) {
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
