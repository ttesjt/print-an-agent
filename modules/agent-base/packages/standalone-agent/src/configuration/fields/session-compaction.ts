import {
  DEFAULT_SESSION_COMPACTION_POLICY,
  validateSessionCompactionPolicy,
} from '@print-an-agent/base-session';
import type { StandaloneSessionCompactionExecutionConfig } from '../types/execution.js';
import {
  assertDataFields,
  assertExactKeys,
  readTimeoutField,
  requireRecord,
} from '../validation.js';

export function parseStandaloneSessionCompactionExecution(
  value: unknown
): StandaloneSessionCompactionExecutionConfig {
  if (value === undefined) {
    return DEFAULT_SESSION_COMPACTION_POLICY;
  }
  const record = requireRecord(value, 'Standalone Session compaction execution');
  assertDataFields(record, 'Standalone Session compaction execution');
  assertExactKeys(
    record,
    Object.keys(DEFAULT_SESSION_COMPACTION_POLICY),
    'Standalone Session compaction execution'
  );
  const policy = validateSessionCompactionPolicy({
    ...DEFAULT_SESSION_COMPACTION_POLICY,
    ...record,
    timeoutMilliseconds: readTimeoutField(
      record,
      'timeoutMilliseconds',
      'Standalone Session compaction timeoutMilliseconds'
    ),
  });
  return policy;
}
