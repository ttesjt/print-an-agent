import type { ReadContextInput, ReadContextResult } from '../contracts/inputs.js';
import type { MemoryStore } from '../contracts/ports.js';
import { assertMemoryNotAborted, ContextMemoryError } from '../errors.js';
import type { MemoryMeter } from '../rendering/meter.js';
import { identity, integer, keys, record } from '../validation/value.js';
import { loadMemory } from './access.js';
import { assertExactMemoryMeasurement } from './budget.js';

export async function readMemoryContext(
  resources: { readonly store: MemoryStore; readonly meter: MemoryMeter },
  input: ReadContextInput,
  signal: AbortSignal = new AbortController().signal
): Promise<ReadContextResult> {
  const parsed = record(input, 'read input');
  keys(parsed, ['memoryId', 'measurementRef', 'maxTokens', 'budgetPolicy']);
  const memoryId = identity(parsed.memoryId, 'memoryId');
  const measurementRef =
    'measurementRef' in parsed ? identity(parsed.measurementRef, 'measurementRef') : undefined;
  const maxTokens = 'maxTokens' in parsed ? integer(parsed.maxTokens, 'maxTokens', 1) : undefined;
  const policy = parsed.budgetPolicy ?? 'enforce';
  if (policy !== 'enforce' && policy !== 'report')
    throw new ContextMemoryError('INPUT_INVALID', 'Unknown read budget policy.');
  const snapshot = await loadMemory(resources.store, memoryId, signal);
  const config = {
    ...snapshot.config,
    ...(measurementRef === undefined ? {} : { measurementRef }),
  };
  const { text, measurement } = await resources.meter.measure(snapshot.items, config, signal);
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
