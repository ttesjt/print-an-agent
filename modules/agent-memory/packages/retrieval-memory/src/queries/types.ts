import type { RetrievalContentQueryOperations } from './content/index.js';
import type { RetrievalSearchOperations } from './search/index.js';

export interface RetrievalQueryOperations
  extends RetrievalContentQueryOperations, RetrievalSearchOperations {}
