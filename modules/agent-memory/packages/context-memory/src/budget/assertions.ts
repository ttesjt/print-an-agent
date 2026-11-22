import { memoryBudgetViolations } from './evaluation.js';
import type { MemoryConfig, MemoryItem, MemoryMeasurement } from '../types/document.js';
import { ContextMemoryError } from '../errors.js';

export function assertMemoryBudget(
  items: readonly MemoryItem[],
  config: MemoryConfig,
  measurement: MemoryMeasurement
): void {
  const violations = memoryBudgetViolations(items, config, measurement);
  const exceeded = (kind: string, actual: number, limit: number) => {
    throw new ContextMemoryError('BUDGET_EXCEEDED', `Memory ${kind} limit exceeded.`, {
      details: {
        kind,
        actual,
        limit,
        measurementRef: measurement.measurementRef,
        rendererRef: measurement.rendererRef,
      },
    });
  };
  for (const kind of ['items', 'item-tokens', 'context-tokens']) {
    const violation = violations.find((issue) => issue.kind === kind);
    if (violation !== undefined) exceeded(violation.kind, violation.actual, violation.limit);
  }
}
