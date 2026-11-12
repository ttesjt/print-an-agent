import type { ProfileId } from '@print-an-agent/workbench-domain';

import { createRecordBackedPersistence } from '../../record-store/create-record-backed-persistence.js';
import { createMemoryPersistenceRecordStore } from './memory-persistence-record-store.js';

export interface MemoryPersistenceOptions {
  readonly profileId?: ProfileId;
}

export function createMemoryPersistence(options: MemoryPersistenceOptions = {}) {
  return createRecordBackedPersistence(createMemoryPersistenceRecordStore(), options);
}
