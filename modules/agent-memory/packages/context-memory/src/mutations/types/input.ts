import type { ItemCommand, ItemContent, MemoryConfigInput } from '../../document/index.js';

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

export type DeterministicMemoryMutation =
  | { readonly operation: 'create'; readonly input: CreateMemoryInput }
  | { readonly operation: 'apply'; readonly input: ApplyMemoryInput }
  | { readonly operation: 'configure'; readonly input: ConfigureMemoryInput };
