import type { ReadContextInput, ReadContextResult } from '../contracts/inputs.js';
import type { MemoryStore } from '../contracts/ports.js';
import type { MemorySnapshot } from '../contracts/document.js';
import { assertMemoryNotAborted, ContextMemoryError } from '../errors.js';
import type { MemoryMeter } from '../rendering/meter.js';
import { identity, integer, keys, record } from '../validation/value.js';
import { loadMemory } from './access.js';
import { assertExactMemoryMeasurement } from './budget.js';

export function parseMemoryReadInput(input: ReadContextInput): ReadContextInput {
  const parsed = record(input, 'read input');
  keys(parsed, ['memoryId', 'measurementRef', 'maxTokens', 'budgetPolicy']);
  const memoryId = identity(parsed.memoryId, 'memoryId');
  const measurementRef =
    'measurementRef' in parsed ? identity(parsed.measurementRef, 'measurementRef') : undefined;
  const maxTokens = 'maxTokens' in parsed ? integer(parsed.maxTokens, 'maxTokens', 1) : undefined;
  const policy = parsed.budgetPolicy ?? 'enforce';
  if (policy !== 'enforce' && policy !== 'report')
    throw new ContextMemoryError('INPUT_INVALID', 'Unknown read budget policy.');
  return {
    memoryId,
    ...(measurementRef === undefined ? {} : { measurementRef }),
    ...(maxTokens === undefined ? {} : { maxTokens }),
    budgetPolicy: policy,
  };
}

export async function readMemoryContext(
  resources: { readonly store: MemoryStore; readonly meter: MemoryMeter },
  input: ReadContextInput,
  signal: AbortSignal = new AbortController().signal
): Promise<ReadContextResult> {
  const parsed = parseMemoryReadInput(input);
  const snapshot = await loadMemory(resources.store, parsed.memoryId, signal);
  return renderMemorySnapshot(resources.meter, snapshot, parsed, signal);
}

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
