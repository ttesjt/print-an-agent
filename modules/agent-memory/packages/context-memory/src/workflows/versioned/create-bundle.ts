import { WorkflowBundle } from '@print-an-agent/workflow-core/bundle';
import { memoryWorkflowDefinitions } from '../deterministic/index.js';
import { memoryHistoryDefinitions } from '../history/index.js';
import type { VersionedMemoryWorkflowResources } from './types/resources.js';
import type { VersionedMemoryWorkflowDefinitions } from './types/definitions.js';
import { createMemoryReadVersionContextDefinition } from './read-context-definition.js';

export function createVersionedContextMemoryBundle(options: {
  readonly resources: VersionedMemoryWorkflowResources;
  readonly workflows?: Partial<VersionedMemoryWorkflowDefinitions>;
}) {
  return new WorkflowBundle({
    resources: options.resources,
    workflows: {
      ...memoryWorkflowDefinitions(),
      ...memoryHistoryDefinitions(),
      readVersionContext: createMemoryReadVersionContextDefinition(),
      ...options.workflows,
    },
  });
}
