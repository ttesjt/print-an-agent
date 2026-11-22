export { COSINE_METRIC_REF, assertCanonicalVector, prepareCosineVector } from './metric.js';
export type { ChunkerResolver, RetrievalChunker } from './chunking/index.js';
export {
  DEFAULT_CHUNK_OVERLAP_CODEPOINTS,
  DEFAULT_CHUNK_WINDOW_CODEPOINTS,
  createCodepointChunker,
} from './chunking/index.js';
export type { EmbeddingResolver } from './embedding/index.js';
export { embedTexts, resolveEmbedding } from './embedding/index.js';
export { parseRepresentation, validateRepresentation } from './validation.js';
export { prepareRepresentation } from './prepare.js';
