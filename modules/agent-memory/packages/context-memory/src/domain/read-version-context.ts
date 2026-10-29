import type { ReadMemoryVersionContextInput } from '../contracts/history.js';
import type { ReadContextResult } from '../contracts/inputs.js';
import type { MemoryStore } from '../contracts/ports.js';
import type { MemoryMeter } from '../rendering/meter.js';
import { ContextMemoryError } from '../errors.js';
import { parseMemoryVersionReference } from '../validation/history.js';
import { keys, record } from '../validation/value.js';
import { inspectMemoryVersion, supportsMemoryHistory } from './history.js';
import { parseMemoryReadInput, renderMemorySnapshot } from './read-context.js';

/** Separate opt-in: existing management/readContext contracts remain current-state only. */
export async function readMemoryVersionContext(
  resources: { readonly store: MemoryStore; readonly meter: MemoryMeter },
  value: ReadMemoryVersionContextInput,
  signal: AbortSignal = new AbortController().signal
): Promise<ReadContextResult> {
  const data = record(value, 'historical context input');
  keys(data, ['memoryId', 'revision', 'measurementRef', 'maxTokens', 'budgetPolicy']);
  const reference = parseMemoryVersionReference({
    memoryId: data.memoryId,
    revision: data.revision,
  });
  const options = { ...data };
  Reflect.deleteProperty(options, 'revision');
  const input = parseMemoryReadInput({ ...options, memoryId: reference.memoryId });
  if (!supportsMemoryHistory(resources.store))
    throw new ContextMemoryError(
      'HISTORY_UNAVAILABLE',
      'This store does not support historical reads.',
      { memoryId: reference.memoryId }
    );
  const snapshot = await inspectMemoryVersion(resources.store, reference, signal);
  return renderMemorySnapshot(resources.meter, snapshot, input, signal);
}
