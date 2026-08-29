import type {
  BaseId,
  ModelBase,
  ModelModification,
  ModificationId,
} from '@ta-agent/workbench-domain';

import type { ParameterRepository } from '../ports/parameter-repository.js';
import type { PersistencePageRequest } from '../ports/persistence-page.js';
import type { PersistenceRecordStore } from './persistence-record-store.js';

export function createRecordStoreParameterRepository(
  store: PersistenceRecordStore
): ParameterRepository {
  return Object.freeze({
    findBase: (baseId: BaseId): Promise<ModelBase | undefined> =>
      Promise.resolve().then(() => store.bases.find(baseId)),
    findModification: (modificationId: ModificationId): Promise<ModelModification | undefined> =>
      Promise.resolve().then(() => store.modifications.find(modificationId)),
    listBases: (request: PersistencePageRequest<BaseId>) =>
      Promise.resolve().then(() => store.bases.list(request)),
    listModifications: (request: PersistencePageRequest<ModificationId>) =>
      Promise.resolve().then(() => store.modifications.list(request)),
  });
}
