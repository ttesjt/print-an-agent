import type { ReadMemoryVersionContextInput } from './types/context.js';
import type { ReadContextResult } from '../context/index.js';
import type { MemoryStore } from '../persistence/index.js';
import type { MemoryMeter } from '../measurement/index.js';
import { ContextMemoryError } from '../errors.js';
import { parseMemoryVersionReference } from './parse-input.js';
import { keys, record } from '../values/index.js';
import { inspectMemoryVersion, supportsMemoryHistory } from './inspect-version.js';
import { parseMemoryReadInput, renderMemorySnapshot } from '../context/index.js';

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
