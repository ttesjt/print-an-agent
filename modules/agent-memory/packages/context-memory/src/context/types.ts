import type { MemoryMeasurement, MemorySnapshot } from '../types/document.js';

export interface ReadContextInput {
  readonly memoryId: string;
  readonly measurementRef?: string;
  readonly maxTokens?: number;
  readonly budgetPolicy?: 'enforce' | 'report';
}

export interface ReadContextResult {
  readonly snapshot: MemorySnapshot;
  readonly text: string;
  readonly measurement: MemoryMeasurement;
  readonly budget:
    | { readonly limit: null; readonly status: 'unbounded' }
    | { readonly limit: number; readonly status: 'fits' | 'exceeded' };
}
