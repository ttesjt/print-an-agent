import type { SearchResult } from '../../types/search.js';
import type { SearchInput } from '../../queries/index.js';

export interface ReadContextInput extends Omit<SearchInput, 'topK'> {
  readonly candidates?: number;
  readonly maxChunks?: number;
  readonly maxTokens?: number | null;
  readonly rendererRef?: string;
  readonly separator?: string;
}

export interface ResolvedContextInput extends ReadContextInput {
  readonly candidates: number;
  readonly maxChunks: number;
  readonly maxTokens: number | null;
  readonly rendererRef: string;
  readonly separator: string;
}

export interface ContextCandidate {
  readonly input: ResolvedContextInput;
  readonly result: SearchResult;
}
