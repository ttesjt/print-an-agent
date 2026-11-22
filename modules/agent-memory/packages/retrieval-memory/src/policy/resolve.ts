import { fail } from '../errors.js';
import type { RetrievalPolicy } from './types.js';
import { DEFAULT_RETRIEVAL_POLICY } from './defaults.js';

export function defineRetrievalPolicy(options: Partial<RetrievalPolicy> = {}): RetrievalPolicy {
  const policy = { ...DEFAULT_RETRIEVAL_POLICY, ...options };
  for (const [key, value] of Object.entries(policy)) {
    if (
      !(key in DEFAULT_RETRIEVAL_POLICY) ||
      (value === null ? key === 'embeddingBatchSize' : !Number.isSafeInteger(value) || value < 1)
    )
      fail('CONFIG_INVALID', 'Memory policy contains an invalid limit.');
  }
  return Object.freeze(policy);
}
