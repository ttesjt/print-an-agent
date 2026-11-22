import {
  createMemoryCreateDefinition,
  createMemoryApplyDefinition,
  createMemoryConfigureDefinition,
  createMemoryReadContextDefinition,
} from './definitions.js';
import { createMemoryGetReceiptDefinition, createMemoryInspectDefinition } from '../state/index.js';
import type { MemoryWorkflowDefinitions } from './types/bundle.js';

/** Internal shared recipe; all public Bundle variants use the same default definitions. */
export function memoryWorkflowDefinitions(
  workflows?: Partial<MemoryWorkflowDefinitions>
): MemoryWorkflowDefinitions {
  return {
    inspect: workflows?.inspect ?? createMemoryInspectDefinition(),
    create: workflows?.create ?? createMemoryCreateDefinition(),
    apply: workflows?.apply ?? createMemoryApplyDefinition(),
    configure: workflows?.configure ?? createMemoryConfigureDefinition(),
    readContext: workflows?.readContext ?? createMemoryReadContextDefinition(),
    getReceipt: workflows?.getReceipt ?? createMemoryGetReceiptDefinition(),
  };
}
