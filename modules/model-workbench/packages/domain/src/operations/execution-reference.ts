import type { RuntimeSupportId } from '../foundation/identifiers.js';
import type { JsonValue } from '../foundation/json.js';

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
