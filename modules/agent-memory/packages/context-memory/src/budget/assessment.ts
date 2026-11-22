import { memoryBudgetViolations } from './evaluation.js';
import type { MemoryConfig, MemoryItem, MemoryMeasurement } from '../types/document.js';
import { assertExactMemoryMeasurement } from './exactness.js';
import type { MemoryBudgetTarget, MemoryCandidateAssessment } from './types.js';

export function assessMemoryCandidate(
  items: readonly MemoryItem[],
  config: MemoryConfig,
  measurement: MemoryMeasurement,
  target?: MemoryBudgetTarget,
  targetMeasurement?: MemoryMeasurement
): MemoryCandidateAssessment {
  const violations = memoryBudgetViolations(items, config, measurement);
  if (target !== undefined && targetMeasurement !== undefined) {
    assertExactMemoryMeasurement(targetMeasurement);
    if (targetMeasurement.tokens > target.maxTokens)
      violations.push({
        kind: 'target-tokens',
        actual: targetMeasurement.tokens,
        limit: target.maxTokens,
      });
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
