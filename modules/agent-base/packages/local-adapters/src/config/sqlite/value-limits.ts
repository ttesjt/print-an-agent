import { AgentConfigError } from '@print-an-agent/base-identity-config/config';

const DEFAULT_MAX_VALUE_BYTES = 1_048_576;

const MAX_VALUE_BYTES_LIMIT = 16_777_216;

export function validateMaxValueBytes(value: number | undefined): number {
  const limit = value ?? DEFAULT_MAX_VALUE_BYTES;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_VALUE_BYTES_LIMIT) {
    throw new AgentConfigError(
      'CONFIG_CONFIGURATION_INVALID',
      `SQLite Config maxValueBytes must be between 1 and ${MAX_VALUE_BYTES_LIMIT}.`
    );
  }
  return limit;
}
