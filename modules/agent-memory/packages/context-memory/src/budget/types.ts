import type { MemoryConfig, TokenTarget, RenderOptions } from '../types/document.js';

export interface MemoryBudgetViolation {
  readonly kind: string;
  readonly actual: number;
  readonly limit: number;
}

export interface MemoryCandidateAssessment {
  readonly accepted: boolean;
  readonly actualTokens: number;
  readonly contentTokens: number;
  readonly targetTokens?: number;
  readonly violations: readonly MemoryBudgetViolation[];
}

export interface MemoryBudgetTarget {
  readonly config: MemoryConfig;
  readonly maxTokens: number;
}

export type CompactionTarget = TokenTarget & {
  readonly render?: RenderOptions;
  readonly measurementRef?: string;
};
