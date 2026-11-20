import type { RetrievalMemoryManagementInputs } from './types/operations.js';

export const RETRIEVAL_MEMORY_MANAGEMENT_OPERATIONS = [
  'inspect',
  'get',
  'getReceipt',
  'list',
  'replay',
  'create',
  'ingest',
  'update',
  'remove',
  'reindex',
  'search',
  'readContext',
] as const satisfies readonly (keyof RetrievalMemoryManagementInputs)[];
