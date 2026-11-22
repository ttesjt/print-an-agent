import type { RetrievalBackend } from '../../../persistence/index.js';

export interface RetrievalContentQueryResources {
  readonly backend: RetrievalBackend;
}
