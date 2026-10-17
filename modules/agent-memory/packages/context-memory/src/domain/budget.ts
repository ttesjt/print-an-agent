import type { MemoryConfig, MemoryItem, MemoryMeasurement } from '../contracts/document.js';
import { ContextMemoryError } from '../errors.js';

export function assertMemoryBudget(
  items: readonly MemoryItem[],
  config: MemoryConfig,
  measurement: MemoryMeasurement
): void {
  const exceeded = (kind: string, actual: number, limit: number) => {
    throw new ContextMemoryError('BUDGET_EXCEEDED', `Memory ${kind} limit exceeded.`, {
      details: {
        kind,
        actual,
        limit,
        tokenizerRef: measurement.tokenizerRef,
        rendererRef: measurement.rendererRef,
      },
    });
  };
  if (config.maxItems !== null && items.length > config.maxItems)
    exceeded('items', items.length, config.maxItems);
  if (config.maxItemTokens !== null) {
    for (const count of measurement.itemTokenCounts)
      if (count.tokenCount > config.maxItemTokens)
        exceeded('item-tokens', count.tokenCount, config.maxItemTokens);
  }
  if (config.maxContextTokens !== null && measurement.tokenCount > config.maxContextTokens)
    exceeded('context-tokens', measurement.tokenCount, config.maxContextTokens);
}
