import type { MemoryHistoryStorageOptions } from './types/storage-options.js';

export const DEFAULT_MAX_MEMORY_DELTA_CHAIN = 32;

export function historyChainLimit(options: MemoryHistoryStorageOptions = {}): number {
  const limit =
    options.maxDeltaChain === undefined ? DEFAULT_MAX_MEMORY_DELTA_CHAIN : options.maxDeltaChain;
  if (!Number.isSafeInteger(limit) || limit < 1)
    throw new Error('maxDeltaChain must be a positive safe integer.');
  return limit;
}
