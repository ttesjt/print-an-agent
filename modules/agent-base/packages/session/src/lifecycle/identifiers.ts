import type { SessionExecutionId } from './execution.js';
import { invalidLifecycle, lifecycleBoundary } from './validation-record.js';

const MAX_OPAQUE_ID_CHARACTERS = 128;
const OPAQUE_ID_PATTERN = /^[a-z0-9](?:[a-z0-9._:-]*[a-z0-9])?$/i;

function opaqueId(input: unknown): string {
  if (
    typeof input !== 'string' ||
    input.length > MAX_OPAQUE_ID_CHARACTERS ||
    !OPAQUE_ID_PATTERN.test(input)
  )
    return invalidLifecycle();
  return input;
}

export function parseSessionExecutionId(input: unknown): SessionExecutionId {
  return lifecycleBoundary(
    'SESSION_EXECUTION_INVALID',
    () => opaqueId(input) as SessionExecutionId
  );
}
