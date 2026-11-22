import type { MutationRequest } from '../types/receipt.js';
import { identity, jsonValue, keys, record } from '../values/index.js';
import type { DeterministicMemoryMutation } from './types/input.js';

/** The same omitted-field semantics and digest input for mutation and state-only replay. */
export function parseDeterministicMemoryRequest(
  operation: DeterministicMemoryMutation['operation'],
  input: unknown
): { readonly request: MutationRequest; readonly data: Record<string, unknown> } {
  const data = record(jsonValue(input), 'mutation input');
  const fields = {
    create: ['items', 'config'],
    apply: ['expectedRevision', 'commands'],
    configure: ['expectedRevision', 'config'],
  };
  keys(data, ['memoryId', 'requestId', ...fields[operation]]);
  return {
    data,
    request: {
      memoryId: identity(data.memoryId, 'memoryId'),
      requestId: identity(data.requestId, 'requestId'),
      operation,
      input: jsonValue(
        Object.fromEntries(
          Object.entries(data).filter(([key]) => key !== 'memoryId' && key !== 'requestId')
        )
      ),
    },
  };
}
