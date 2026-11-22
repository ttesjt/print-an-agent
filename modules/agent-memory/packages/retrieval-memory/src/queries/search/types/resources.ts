import type { RetrievalBackend } from '../../../persistence/index.js';
import type { EmbeddingResolver } from '../../../representation/index.js';

export interface RetrievalSearchResources {
  readonly backend: RetrievalBackend;
  readonly embeddings: EmbeddingResolver;
}
