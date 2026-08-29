import { parseRuntimeSupportId, type RuntimeSupportId } from '../foundation/identifiers.js';
import { parseJsonValue, type JsonValue } from '../foundation/json.js';
import { parseClosedRecord } from '../foundation/record-parser.js';

/**
 * Durable bridge from a Workbench Run to the backend execution that it governs.
 * The receipt is deliberately opaque to Workbench and meaningful only to the selected support.
 */
export interface ExecutionReference {
  readonly runtimeSupportId: RuntimeSupportId;
  readonly receipt: JsonValue;
}

export function defineExecutionReference(input: ExecutionReference): ExecutionReference {
  return Object.freeze({ ...input });
}

export function parseExecutionReference(
  input: unknown,
  path = 'executionReference'
): ExecutionReference {
  const record = parseClosedRecord(input, path, ['runtimeSupportId', 'receipt']);
  return defineExecutionReference({
    runtimeSupportId: parseRuntimeSupportId(record.runtimeSupportId, `${path}.runtimeSupportId`),
    receipt: parseJsonValue(record.receipt, `${path}.receipt`),
  });
}
