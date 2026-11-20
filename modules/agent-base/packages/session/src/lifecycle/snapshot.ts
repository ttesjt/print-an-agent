import { REFERENCE_FIELDS, referenceFields } from '../contracts/index.js';

import {
  authorityBoundary,
  authorityField,
  authorityInteger,
  authorityRecord,
  invalidAuthority,
} from '../validation/authority-record.js';

import type { SessionLifecycleSnapshot } from './state/index.js';

export function defineSessionLifecycleSnapshot(input: unknown): SessionLifecycleSnapshot {
  return authorityBoundary('SESSION_LIFECYCLE_INVALID', () => {
    const fields = [...REFERENCE_FIELDS, 'status', 'metadataRevision', 'metadataUpdatedAt'];
    const record = authorityRecord(input, fields, ['retiredAt']);
    const status = authorityField(record, 'status');
    const base = {
      ...referenceFields(record),
      metadataRevision: authorityInteger(authorityField(record, 'metadataRevision')),
      metadataUpdatedAt: authorityInteger(authorityField(record, 'metadataUpdatedAt')),
    };
    if (status === 'active') {
      authorityRecord(record, fields);
      return Object.freeze({ ...base, status });
    }
    if (status !== 'retired') return invalidAuthority();
    const retiredAt = authorityInteger(authorityField(record, 'retiredAt'));
    if (retiredAt > base.metadataUpdatedAt) return invalidAuthority();
    return Object.freeze({ ...base, status, retiredAt });
  });
}
