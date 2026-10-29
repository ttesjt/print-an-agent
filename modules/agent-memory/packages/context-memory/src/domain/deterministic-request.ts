import type {
  ApplyMemoryInput,
  ConfigureMemoryInput,
  CreateMemoryInput,
} from '../contracts/inputs.js';
import type { MutationRequest } from '../contracts/receipt.js';
import { identity, jsonValue, keys, record } from '../validation/value.js';

export type DeterministicMemoryMutation =
  | { readonly operation: 'create'; readonly input: CreateMemoryInput }
  | { readonly operation: 'apply'; readonly input: ApplyMemoryInput }
  | { readonly operation: 'configure'; readonly input: ConfigureMemoryInput };

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
