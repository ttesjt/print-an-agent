import type { MemoryConfig, MemoryItem, MemoryMeasurement } from '../contracts/document.js';
import { assertExactMemoryMeasurement } from '../domain/budget.js';
import type { MemoryBudgetTarget } from './targets.js';

export interface MemoryBudgetViolation {
  readonly kind: string;
  readonly actual: number;
  readonly limit: number;
}
export interface MemoryCandidateAssessment {
  readonly accepted: boolean;
  readonly actualTokens: number;
  readonly contentTokens: number;
  readonly targetTokens?: number;
  readonly violations: readonly MemoryBudgetViolation[];
}
export function assessMemoryCandidate(
  items: readonly MemoryItem[],
  config: MemoryConfig,
  measurement: MemoryMeasurement,
  target?: MemoryBudgetTarget,
  targetMeasurement?: MemoryMeasurement
): MemoryCandidateAssessment {
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
  if (target !== undefined && targetMeasurement !== undefined) {
    assertExactMemoryMeasurement(targetMeasurement);
    check('target-tokens', targetMeasurement.tokens, target.maxTokens);
  }
  const primary = targetMeasurement ?? measurement;
  return {
    accepted: violations.length === 0,
    actualTokens: primary.tokens,
    contentTokens: primary.itemTokenCounts.reduce((sum, item) => sum + item.tokens, 0),
    ...(target === undefined ? {} : { targetTokens: target.maxTokens }),
    violations,
  };
}
