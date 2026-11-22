import type { ReadContextInput, ReadContextResult } from './types.js';
import type { MemorySnapshot } from '../types/document.js';
import { assertMemoryNotAborted, ContextMemoryError } from '../errors.js';
import type { MemoryMeter } from '../measurement/index.js';
import { assertExactMemoryMeasurement } from '../budget/index.js';

/** Internal shared measured-read implementation; callers select state before rendering it. */
export async function renderMemorySnapshot(
  meter: MemoryMeter,
  snapshot: MemorySnapshot,
  input: ReadContextInput,
  signal: AbortSignal
): Promise<ReadContextResult> {
  const { memoryId, measurementRef, maxTokens } = input;
  const policy = input.budgetPolicy ?? 'enforce';
  const config = {
    ...snapshot.config,
    ...(measurementRef === undefined ? {} : { measurementRef }),
  };
  const { text, measurement } = await meter.measure(snapshot.items, config, signal);
  assertMemoryNotAborted(signal);
  const limit = maxTokens ?? config.maxContextTokens;
  if (policy === 'enforce' && limit !== null) assertExactMemoryMeasurement(measurement);
  const exceeded = limit !== null && measurement.tokens > limit;
  if (policy === 'enforce' && exceeded)
    throw new ContextMemoryError('BUDGET_EXCEEDED', 'Rendered memory exceeds this read budget.', {
      memoryId,
      details: {
        revision: snapshot.revision,
        limit,
        actual: measurement.tokens,
        measurementRef: measurement.measurementRef,
        rendererRef: measurement.rendererRef,
      },
    });
  return {
    snapshot,
    text,
    measurement,
    budget:
      limit === null
        ? { limit, status: 'unbounded' }
        : { limit, status: exceeded ? 'exceeded' : 'fits' },
  };
}
