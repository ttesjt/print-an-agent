import type { SessionReference } from '../types.js';
import { parseAgentId } from '@print-an-agent/base-identity';
import { parseSessionId } from '../identifiers.js';
import { DEFAULT_SESSION_QUERY_LIMIT, MAX_SESSION_QUERY_LIMIT } from '../query/contracts.js';
import type {
  PurgeSessionInput,
  SessionLifecycleMutationInput,
  SessionLifecycleSnapshot,
  RetiredSessionListCursor,
} from './contracts.js';
import type {
  RecoverSessionExecutionsInput,
  SessionExecutionFence,
  SessionExecutionLease,
} from './execution.js';
import { parseSessionExecutionId } from './identifiers.js';
import {
  invalidLifecycle,
  lifecycleBoundary,
  lifecycleField,
  lifecycleInteger,
  lifecycleRecord,
  optionalLifecycleField,
} from './validation-record.js';

const REFERENCE_FIELDS = ['agentId', 'sessionId'];
const MUTATION_FIELDS = [...REFERENCE_FIELDS, 'expectedRevision'];

function referenceFields(record: object): SessionReference {
  return Object.freeze({
    agentId: parseAgentId(lifecycleField(record, 'agentId')),
    sessionId: parseSessionId(lifecycleField(record, 'sessionId')),
  });
}

function mutationFields(record: object): SessionLifecycleMutationInput {
  return Object.freeze({
    ...referenceFields(record),
    expectedRevision: lifecycleInteger(lifecycleField(record, 'expectedRevision')),
  });
}

export function normalizeSessionReference(input: unknown): SessionReference {
  return lifecycleBoundary('SESSION_LIFECYCLE_INVALID', () =>
    referenceFields(lifecycleRecord(input, REFERENCE_FIELDS))
  );
}

export function normalizeSessionLifecycleMutationInput(
  input: unknown
): SessionLifecycleMutationInput {
  return lifecycleBoundary('SESSION_LIFECYCLE_INVALID', () =>
    mutationFields(lifecycleRecord(input, MUTATION_FIELDS))
  );
}

export function normalizePurgeSessionInput(input: unknown): PurgeSessionInput {
  return lifecycleBoundary('SESSION_PURGE_INVALID', () => {
    const record = lifecycleRecord(input, [...MUTATION_FIELDS, 'confirmation']);
    if (lifecycleField(record, 'confirmation') !== 'permanently-delete-session') {
      return invalidLifecycle();
    }
    return Object.freeze({ ...mutationFields(record), confirmation: 'permanently-delete-session' });
  });
}

export function defineSessionLifecycleSnapshot(input: unknown): SessionLifecycleSnapshot {
  return lifecycleBoundary('SESSION_LIFECYCLE_INVALID', () => {
    const fields = [...REFERENCE_FIELDS, 'status', 'metadataRevision', 'metadataUpdatedAt'];
    const record = lifecycleRecord(input, fields, ['retiredAt']);
    const status = lifecycleField(record, 'status');
    const base = {
      ...referenceFields(record),
      metadataRevision: lifecycleInteger(lifecycleField(record, 'metadataRevision')),
      metadataUpdatedAt: lifecycleInteger(lifecycleField(record, 'metadataUpdatedAt')),
    };
    if (status === 'active') {
      lifecycleRecord(record, fields);
      return Object.freeze({ ...base, status });
    }
    if (status !== 'retired') return invalidLifecycle();
    const retiredAt = lifecycleInteger(lifecycleField(record, 'retiredAt'));
    if (retiredAt > base.metadataUpdatedAt) return invalidLifecycle();
    return Object.freeze({ ...base, status, retiredAt });
  });
}

export function defineSessionExecutionFence(input: unknown): SessionExecutionFence {
  return lifecycleBoundary('SESSION_EXECUTION_INVALID', () => {
    const record = lifecycleRecord(input, [
      'revision',
      'state',
      'activeLeaseCount',
      'pendingWorkCount',
    ]);
    const state = lifecycleField(record, 'state');
    if (state !== 'ready' && state !== 'recovering') return invalidLifecycle();
    return Object.freeze({
      revision: lifecycleInteger(lifecycleField(record, 'revision')),
      state,
      activeLeaseCount: lifecycleInteger(lifecycleField(record, 'activeLeaseCount')),
      pendingWorkCount: lifecycleInteger(lifecycleField(record, 'pendingWorkCount')),
    });
  });
}

export function normalizeSessionExecutionLease(input: unknown): SessionExecutionLease {
  return lifecycleBoundary('SESSION_EXECUTION_INVALID', () => {
    const record = lifecycleRecord(input, [...REFERENCE_FIELDS, 'executionId']);
    return Object.freeze({
      ...referenceFields(record),
      executionId: parseSessionExecutionId(lifecycleField(record, 'executionId')),
    });
  });
}

export function normalizeRecoverSessionExecutionsInput(
  input: unknown
): RecoverSessionExecutionsInput {
  return lifecycleBoundary('SESSION_EXECUTION_INVALID', () => {
    const record = lifecycleRecord(input, [...REFERENCE_FIELDS, 'expectedExecutionRevision']);
    return Object.freeze({
      ...referenceFields(record),
      expectedExecutionRevision: lifecycleInteger(
        lifecycleField(record, 'expectedExecutionRevision')
      ),
    });
  });
}

export interface NormalizedListRetiredSessionsInput {
  readonly agentId: ReturnType<typeof parseAgentId>;
  readonly limit: number;
  readonly cursor?: RetiredSessionListCursor;
}

export function normalizeListRetiredSessionsInput(
  input: unknown
): NormalizedListRetiredSessionsInput {
  return lifecycleBoundary('SESSION_QUERY_INVALID', () => {
    const record = lifecycleRecord(input, ['agentId'], ['limit', 'cursor']);
    const requestedLimit = optionalLifecycleField(record, 'limit');
    const limit = lifecycleInteger(
      requestedLimit === undefined ? DEFAULT_SESSION_QUERY_LIMIT : requestedLimit
    );
    if (limit < 1 || limit > MAX_SESSION_QUERY_LIMIT) return invalidLifecycle();
    const cursorInput = optionalLifecycleField(record, 'cursor');
    const base = { agentId: parseAgentId(lifecycleField(record, 'agentId')), limit };
    if (cursorInput === undefined) return Object.freeze(base);
    const cursor = lifecycleRecord(cursorInput, ['retiredAt', 'sessionId']);
    return Object.freeze({
      ...base,
      cursor: Object.freeze({
        retiredAt: lifecycleInteger(lifecycleField(cursor, 'retiredAt')),
        sessionId: parseSessionId(lifecycleField(cursor, 'sessionId')),
      }),
    });
  });
}
