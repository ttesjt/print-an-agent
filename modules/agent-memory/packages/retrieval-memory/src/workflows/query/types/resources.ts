import type { RetrievalQueryOperations } from '../../../queries/index.js';
import type { RetrievalExecutionPolicy } from '../../shared/index.js';

export interface RetrievalQueryResources<K extends keyof RetrievalQueryOperations> {
  readonly execution?: RetrievalExecutionPolicy;
  readonly queries: Pick<RetrievalQueryOperations, K>;
}
