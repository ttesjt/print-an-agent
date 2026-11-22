import type { MemoryMeasurement } from '../types/document.js';
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
