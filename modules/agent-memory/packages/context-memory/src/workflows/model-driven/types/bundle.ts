import type { ModelMemoryResources } from './resources.js';
import type {
  createMemoryObserveDefinition,
  createMemoryEditDefinition,
  createMemoryCompactDefinition,
} from '../create-definition.js';
import type { MemoryWorkflowDefinitions } from '../../deterministic/index.js';

export interface ModelMemoryWorkflowDefinitions extends MemoryWorkflowDefinitions {
  readonly observe: ReturnType<typeof createMemoryObserveDefinition>;
  readonly edit: ReturnType<typeof createMemoryEditDefinition>;
  readonly compact: ReturnType<typeof createMemoryCompactDefinition>;
}

export interface ModelContextMemoryBundleOptions {
  readonly resources: ModelMemoryResources;
  readonly workflows?: Partial<ModelMemoryWorkflowDefinitions>;
}
