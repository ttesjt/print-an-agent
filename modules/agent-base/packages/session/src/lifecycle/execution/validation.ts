import { REFERENCE_FIELDS, referenceFields } from '../../contracts/index.js';
import {
  authorityBoundary,
  authorityField,
  authorityInteger,
  authorityRecord,
  invalidAuthority,
} from '../../validation/authority-record.js';
import { parseSessionExecutionId } from './identifiers.js';
import type { SessionExecutionFence } from './types/fence.js';
import type { SessionExecutionLease } from './types/lease.js';

export function defineSessionExecutionFence(input: unknown): SessionExecutionFence {
  return authorityBoundary('SESSION_EXECUTION_INVALID', () => {
    const record = authorityRecord(input, [
      'revision',
      'state',
      'activeLeaseCount',
      'pendingWorkCount',
    ]);
    const state = authorityField(record, 'state');
    if (state !== 'ready' && state !== 'recovering') return invalidAuthority();
    return Object.freeze({
      revision: authorityInteger(authorityField(record, 'revision')),
      state,
      activeLeaseCount: authorityInteger(authorityField(record, 'activeLeaseCount')),
      pendingWorkCount: authorityInteger(authorityField(record, 'pendingWorkCount')),
    });
  });
}

export function normalizeSessionExecutionLease(input: unknown): SessionExecutionLease {
  return authorityBoundary('SESSION_EXECUTION_INVALID', () => {
    const record = authorityRecord(input, [...REFERENCE_FIELDS, 'executionId']);
    return Object.freeze({
      ...referenceFields(record),
      executionId: parseSessionExecutionId(authorityField(record, 'executionId')),
    });
  });
}
