import type {
  createMemoryCreateDefinition,
  createMemoryApplyDefinition,
  createMemoryConfigureDefinition,
  createMemoryReadContextDefinition,
  createMemoryGetReceiptDefinition,
  createMemoryInspectDefinition,
} from '../../deterministic.js';
import type { MemoryWorkflowResources } from './resources.js';

export interface MemoryWorkflowDefinitions {
  readonly inspect: ReturnType<typeof createMemoryInspectDefinition>;
  readonly create: ReturnType<typeof createMemoryCreateDefinition>;
  readonly apply: ReturnType<typeof createMemoryApplyDefinition>;
  readonly configure: ReturnType<typeof createMemoryConfigureDefinition>;
  readonly readContext: ReturnType<typeof createMemoryReadContextDefinition>;
  readonly getReceipt: ReturnType<typeof createMemoryGetReceiptDefinition>;
}

export interface ContextMemoryBundleOptions {
  readonly resources: MemoryWorkflowResources;
  readonly workflows?: Partial<MemoryWorkflowDefinitions>;
}
