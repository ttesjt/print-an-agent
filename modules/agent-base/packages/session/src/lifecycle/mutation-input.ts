import { REFERENCE_FIELDS, referenceFields } from '../contracts/index.js';
import {
  authorityBoundary,
  authorityField,
  authorityInteger,
  authorityRecord,
  invalidAuthority,
} from '../validation/authority-record.js';
import type { SessionLifecycleMutationInput } from './state/index.js';
import type { PurgeSessionInput } from './types/management.js';

const MUTATION_FIELDS = [...REFERENCE_FIELDS, 'expectedRevision'];

function mutationFields(record: object): SessionLifecycleMutationInput {
  return Object.freeze({
    ...referenceFields(record),
    expectedRevision: authorityInteger(authorityField(record, 'expectedRevision')),
  });
}

export function normalizeSessionLifecycleMutationInput(
  input: unknown
): SessionLifecycleMutationInput {
  return authorityBoundary('SESSION_LIFECYCLE_INVALID', () =>
    mutationFields(authorityRecord(input, MUTATION_FIELDS))
  );
}

export function normalizePurgeSessionInput(input: unknown): PurgeSessionInput {
  return authorityBoundary('SESSION_PURGE_INVALID', () => {
    const record = authorityRecord(input, [...MUTATION_FIELDS, 'confirmation']);
    if (authorityField(record, 'confirmation') !== 'permanently-delete-session') {
      return invalidAuthority();
    }
    return Object.freeze({ ...mutationFields(record), confirmation: 'permanently-delete-session' });
  });
}
