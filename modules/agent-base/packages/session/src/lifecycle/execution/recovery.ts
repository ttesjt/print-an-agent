import { REFERENCE_FIELDS, referenceFields } from '../../contracts/index.js';
import { AgentSessionError } from '../../errors.js';
import {
  authorityBoundary,
  authorityField,
  authorityInteger,
  authorityRecord,
} from '../../validation/authority-record.js';
import type { SessionLifecycleSnapshot } from '../state/index.js';
import { requireSessionReference } from '../state/index.js';
import type { SessionExecutionFence } from './types/fence.js';
import type { RecoverSessionExecutionsInput } from './types/recovery.js';

/** Recovery admission CAS; the adapter must also serialize recovery ownership. */
export function assertSessionRecoveryRevision(
  current: SessionLifecycleSnapshot | undefined,
  input: RecoverSessionExecutionsInput,
  fence: SessionExecutionFence
): void {
  requireSessionReference(current, input);
  if (fence.revision !== input.expectedExecutionRevision) {
    throw new AgentSessionError(
      'SESSION_EXECUTION_CONFLICT',
      'Session execution occupancy changed.'
    );
  }
}

export function normalizeRecoverSessionExecutionsInput(
  input: unknown
): RecoverSessionExecutionsInput {
  return authorityBoundary('SESSION_EXECUTION_INVALID', () => {
    const record = authorityRecord(input, [...REFERENCE_FIELDS, 'expectedExecutionRevision']);
    return Object.freeze({
      ...referenceFields(record),
      expectedExecutionRevision: authorityInteger(
        authorityField(record, 'expectedExecutionRevision')
      ),
    });
  });
}
