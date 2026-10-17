import type { ReadContextInput, ReadContextResult } from '../contracts/inputs.js';
import type { MemoryStore } from '../contracts/ports.js';
import { assertMemoryNotAborted, ContextMemoryError } from '../errors.js';
import type { MemoryMeter } from '../rendering/meter.js';
import { identity, integer, keys, record } from '../validation/value.js';
import { loadMemory } from './access.js';

export async function readMemoryContext(
  resources: { readonly store: MemoryStore; readonly meter: MemoryMeter },
  input: ReadContextInput,
  signal: AbortSignal = new AbortController().signal
): Promise<ReadContextResult> {
  const parsed = record(input, 'read input');
  keys(parsed, ['memoryId', 'tokenizerRef', 'maxTokens', 'budgetPolicy']);
  const memoryId = identity(parsed.memoryId, 'memoryId');
  const tokenizerRef =
    'tokenizerRef' in parsed ? identity(parsed.tokenizerRef, 'tokenizerRef') : undefined;
  const maxTokens = 'maxTokens' in parsed ? integer(parsed.maxTokens, 'maxTokens', 1) : undefined;
  const policy = parsed.budgetPolicy ?? 'enforce';
  if (policy !== 'enforce' && policy !== 'report')
    throw new ContextMemoryError('INPUT_INVALID', 'Unknown read budget policy.');
  const snapshot = await loadMemory(resources.store, memoryId, signal);
  const config = { ...snapshot.config, ...(tokenizerRef === undefined ? {} : { tokenizerRef }) };
  const { text, measurement } = await resources.meter.measure(snapshot.items, config, signal);
  assertMemoryNotAborted(signal);
  const limit = maxTokens ?? config.maxContextTokens;
  const exceeded = limit !== null && measurement.tokenCount > limit;
  if (policy === 'enforce' && exceeded)
    throw new ContextMemoryError('BUDGET_EXCEEDED', 'Rendered memory exceeds this read budget.', {
      memoryId,
      details: {
        revision: snapshot.revision,
        limit,
        actual: measurement.tokenCount,
        tokenizerRef: measurement.tokenizerRef,
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
