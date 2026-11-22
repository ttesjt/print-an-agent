import type { ChunkContent } from '../../types/representation.js';

export interface RetrievalChunker {
  readonly ref: string;
  chunk(content: string, signal: AbortSignal): Promise<readonly ChunkContent[]>;
}

export interface ChunkerResolver {
  resolve(ref: string, signal: AbortSignal): RetrievalChunker | Promise<RetrievalChunker>;
}
