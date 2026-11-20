import type { ContextMemoryManagementInputs } from './types/operations.js';

export const CONTEXT_MEMORY_MANAGEMENT_OPERATIONS = [
  'inspect',
  'getReceipt',
  'replay',
  'create',
  'apply',
  'configure',
  'readContext',
] as const satisfies readonly (keyof ContextMemoryManagementInputs)[];
