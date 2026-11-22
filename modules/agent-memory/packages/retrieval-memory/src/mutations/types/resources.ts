import type { RetrievalBackend } from '../../persistence/index.js';
import type { EmbeddingResolver, ChunkerResolver } from '../../representation/index.js';

export interface RetrievalResources {
  readonly backend: RetrievalBackend;
  readonly embeddings: EmbeddingResolver;
  readonly chunkers: ChunkerResolver;
}
