export const MEMORY_OPERATIONS = [
  'create',
  'fork',
  'configure',
  'apply',
  'observe',
  'edit',
  'compact',
] as const;

export type MemoryOperation = (typeof MEMORY_OPERATIONS)[number];
