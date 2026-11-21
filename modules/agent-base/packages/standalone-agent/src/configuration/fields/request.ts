import { DEFAULT_REQUEST_POLICY, validateRequestPolicy } from '@print-an-agent/base-request';
import type { StandaloneRequestExecutionConfig } from '../types/execution.js';
import {
  assertDataFields,
  assertExactKeys,
  EXECUTION_TIMEOUT_KEYS,
  readTimeoutField,
  requireRecord,
} from '../validation.js';

export function parseStandaloneRequestExecution(value: unknown): StandaloneRequestExecutionConfig {
  if (value === undefined) {
    return Object.freeze({ timeoutMilliseconds: DEFAULT_REQUEST_POLICY.timeoutMilliseconds });
  }
  const record = requireRecord(value, 'Standalone Request execution');
  assertDataFields(record, 'Standalone Request execution');
  assertExactKeys(record, EXECUTION_TIMEOUT_KEYS, 'Standalone Request execution');
  const policy = validateRequestPolicy({
    ...DEFAULT_REQUEST_POLICY,
    timeoutMilliseconds: readTimeoutField(
      record,
      'timeoutMilliseconds',
      'Standalone Request timeoutMilliseconds'
    ),
  });
  return Object.freeze({ timeoutMilliseconds: policy.timeoutMilliseconds });
}
