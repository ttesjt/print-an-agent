export const MUTATION_OPERATIONS = ['create', 'ingest', 'update', 'remove', 'reindex'] as const;

export type MutationOperation = (typeof MUTATION_OPERATIONS)[number];

export function isMutationOperation(value: unknown): value is MutationOperation {
  return MUTATION_OPERATIONS.some((operation) => operation === value);
}
