import type {
  BaseId,
  ModelBase,
  ModelModification,
  ModificationId,
} from '@ta-agent/workbench-domain';

export interface ParameterRepository {
  findBase(baseId: BaseId): Promise<ModelBase | undefined>;
  findModification(modificationId: ModificationId): Promise<ModelModification | undefined>;
}
