import type { BaseId, ModelBase } from '@ta-agent/workbench-domain';

export interface ParameterRepository {
  findBase(baseId: BaseId): Promise<ModelBase | undefined>;
}
