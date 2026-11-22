import type { ForkMemoryInput } from './types/fork.js';
import type { MutationRequest } from '../types/receipt.js';
import { parseForkMemoryInput } from './parse-input.js';
import { jsonValue } from '../values/index.js';

/** One canonical identity shared by preflight replay and the adapter's final arbitration. */
export function parseMemoryForkRequest(value: unknown): {
  readonly input: ForkMemoryInput;
  readonly request: MutationRequest;
} {
  const input = parseForkMemoryInput(value);
  return {
    input,
    request: {
      memoryId: input.memoryId,
      requestId: input.requestId,
      operation: 'fork',
      input: jsonValue({ source: input.source }),
    },
  };
}
