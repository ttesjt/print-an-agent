import type { MemoryWorkflowDefinitions } from '../../deterministic/types/bundle.js';
import type { MemoryHistoryWorkflowDefinitions } from '../../history/types/definitions.js';
import type { createMemoryReadVersionContextDefinition } from '../read-context-definition.js';

export type VersionedMemoryWorkflowDefinitions = MemoryWorkflowDefinitions &
  MemoryHistoryWorkflowDefinitions & {
    readonly readVersionContext: ReturnType<typeof createMemoryReadVersionContextDefinition>;
  };
