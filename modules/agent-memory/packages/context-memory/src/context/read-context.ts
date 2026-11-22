import type { ReadContextInput, ReadContextResult } from './types.js';
import type { MemoryStore } from '../persistence/index.js';
import { ContextMemoryError } from '../errors.js';
import type { MemoryMeter } from '../measurement/index.js';
import { identity, integer, keys, record } from '../values/index.js';
import { loadMemory } from '../persistence/index.js';
import { renderMemorySnapshot } from './render-snapshot.js';

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
