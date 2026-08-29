import type { ProfileId } from '@ta-agent/workbench-domain';

import type { ProfilePersistence } from '../ports/profile-persistence-adapter.js';
import { createRecordStoreExportCommitter } from './record-store-export-committer.js';
import { createRecordStoreInitializationCommitter } from './record-store-initialization-committer.js';
import { createRecordStoreOutputRepository } from './record-store-output-repository.js';
import { createRecordStoreParameterRepository } from './record-store-parameter-repository.js';
import type { PersistenceRecordStore } from './persistence-record-store.js';
import { createRecordStoreRunRepository } from './record-store-run-repository.js';
import { createRecordStoreTrainingCommitter } from './record-store-training-committer.js';

export interface RecordBackedPersistenceOptions {
  readonly profileId?: ProfileId;
}

export function createRecordBackedPersistence(
  store: PersistenceRecordStore,
  options: RecordBackedPersistenceOptions = {}
): ProfilePersistence {
  return Object.freeze({
    runs: createRecordStoreRunRepository(store, options),
    parameters: createRecordStoreParameterRepository(store),
    outputs: createRecordStoreOutputRepository(store),
    commits: Object.freeze({
      initialization: createRecordStoreInitializationCommitter(store, options),
      training: createRecordStoreTrainingCommitter(store, options),
      export: createRecordStoreExportCommitter(store, options),
    }),
  });
}
