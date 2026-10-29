import type { ForkMemoryInput } from '../contracts/history.js';
import type { MutationRequest } from '../contracts/receipt.js';
import { parseForkMemoryInput } from '../validation/history.js';
import { jsonValue } from '../validation/value.js';

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
