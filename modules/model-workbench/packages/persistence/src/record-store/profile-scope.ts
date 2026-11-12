import type { ProfileId } from '@print-an-agent/workbench-domain';

import { PersistenceProfileScopeError } from '../errors.js';

export interface ProfileScopedRecord {
  readonly profileId: ProfileId;
}

export function assertProfileScope(
  expectedProfileId: ProfileId | undefined,
  record: ProfileScopedRecord,
  recordKind: string,
  identity: string
): void {
  if (expectedProfileId !== undefined && record.profileId !== expectedProfileId) {
    throw new PersistenceProfileScopeError(
      recordKind,
      identity,
      expectedProfileId,
      record.profileId
    );
  }
}
