import type {
  ItemCommand,
  ItemContent,
  MemoryConfigInput,
  MemoryMeasurement,
  MemorySnapshot,
  TokenTarget,
  RenderOptions,
} from './document.js';

export interface CreateMemoryInput {
  readonly memoryId: string;
  readonly requestId: string;
  readonly items?: readonly ItemContent[];
  readonly config?: MemoryConfigInput;
}
export interface ApplyMemoryInput {
  readonly memoryId: string;
  readonly requestId: string;
  readonly expectedRevision: number;
  readonly commands: readonly ItemCommand[];
}
export interface ConfigureMemoryInput {
  readonly memoryId: string;
  readonly requestId: string;
  readonly expectedRevision: number;
  readonly config: MemoryConfigInput;
}
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
export type CompactionTarget = TokenTarget & {
  readonly render?: RenderOptions;
  readonly measurementRef?: string;
};
