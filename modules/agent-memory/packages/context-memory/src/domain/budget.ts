import type { MemoryConfig, MemoryItem, MemoryMeasurement } from '../contracts/document.js';
import { ContextMemoryError } from '../errors.js';
import { TOKEN_MEASUREMENT_ACCURACY } from '@print-an-agent/model-invocation-core';

export function assertExactMemoryMeasurement(
  measurement: MemoryMeasurement,
  perItem = false
): void {
  if (
    measurement.accuracy !== TOKEN_MEASUREMENT_ACCURACY.EXACT ||
    (perItem &&
      measurement.itemTokenCounts.some(
        (count) => count.accuracy !== TOKEN_MEASUREMENT_ACCURACY.EXACT
      ))
  )
    throw new ContextMemoryError(
      'TOKEN_MEASUREMENT_INEXACT',
      'Finite token budgets require exact text measurement.'
    );
}

export function assertMemoryBudget(
  items: readonly MemoryItem[],
  config: MemoryConfig,
  measurement: MemoryMeasurement
): void {
  if (config.maxContextTokens !== null || config.maxItemTokens !== null)
    assertExactMemoryMeasurement(measurement, config.maxItemTokens !== null);
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
  if (config.maxItems !== null && items.length > config.maxItems)
    exceeded('items', items.length, config.maxItems);
  if (config.maxItemTokens !== null) {
    for (const count of measurement.itemTokenCounts)
      if (count.tokens > config.maxItemTokens)
        exceeded('item-tokens', count.tokens, config.maxItemTokens);
  }
  if (config.maxContextTokens !== null && measurement.tokens > config.maxContextTokens)
    exceeded('context-tokens', measurement.tokens, config.maxContextTokens);
}
