import type { MemoryConfig, MemoryItem, MemoryMeasurement } from '../types/document.js';
import type { MemoryBudgetViolation } from './types.js';
import { assertExactMemoryMeasurement } from './exactness.js';

/** One document-limit evaluation; callers retain their own presentation and error priority. */
export function memoryBudgetViolations(
  items: readonly MemoryItem[],
  config: MemoryConfig,
  measurement: MemoryMeasurement
): MemoryBudgetViolation[] {
  if (config.maxContextTokens !== null || config.maxItemTokens !== null)
    assertExactMemoryMeasurement(measurement, config.maxItemTokens !== null);
  const violations: MemoryBudgetViolation[] = [];
  const check = (kind: string, actual: number, limit: number | null) => {
    if (limit !== null && actual > limit) violations.push({ kind, actual, limit });
  };
  check('context-tokens', measurement.tokens, config.maxContextTokens);
  check('items', items.length, config.maxItems);
  for (const count of measurement.itemTokenCounts)
    check('item-tokens', count.tokens, config.maxItemTokens);
  return violations;
}
