import { authorityBoundary, invalidAuthority } from '../../validation/authority-record.js';
import type { SessionExecutionId } from './types/lease.js';

const MAX_OPAQUE_ID_CHARACTERS = 128;
const OPAQUE_ID_PATTERN = /^[a-z0-9](?:[a-z0-9._:-]*[a-z0-9])?$/i;

function opaqueId(input: unknown): string {
  if (
    typeof input !== 'string' ||
    input.length > MAX_OPAQUE_ID_CHARACTERS ||
    !OPAQUE_ID_PATTERN.test(input)
  )
    return invalidAuthority();
  return input;
}

export function parseSessionExecutionId(input: unknown): SessionExecutionId {
  return authorityBoundary(
    'SESSION_EXECUTION_INVALID',
    () => opaqueId(input) as SessionExecutionId
  );
}
