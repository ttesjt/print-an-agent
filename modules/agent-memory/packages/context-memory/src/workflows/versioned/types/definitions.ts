import type { MemoryWorkflowDefinitions } from '../../deterministic/index.js';
import type { MemoryHistoryWorkflowDefinitions } from '../../history/index.js';
import type { createMemoryReadVersionContextDefinition } from '../read-context-definition.js';

export type VersionedMemoryWorkflowDefinitions = MemoryWorkflowDefinitions &
  MemoryHistoryWorkflowDefinitions & {
    readonly readVersionContext: ReturnType<typeof createMemoryReadVersionContextDefinition>;
  };
