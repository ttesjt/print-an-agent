import type {
  BaseId,
  ModelBase,
  ModelModification,
  ModificationId,
} from '@ta-agent/workbench-domain';
import type { PersistencePage, PersistencePageRequest } from './persistence-page.js';

export interface ParameterRepository {
  findBase(baseId: BaseId): Promise<ModelBase | undefined>;
  findModification(modificationId: ModificationId): Promise<ModelModification | undefined>;
  listBases(request: PersistencePageRequest<BaseId>): Promise<PersistencePage<ModelBase>>;
  listModifications(
    request: PersistencePageRequest<ModificationId>
  ): Promise<PersistencePage<ModelModification>>;
}
