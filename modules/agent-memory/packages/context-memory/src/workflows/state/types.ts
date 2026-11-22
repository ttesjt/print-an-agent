import type { MemorySnapshot } from '../../types/document.js';
import type { MemoryReceipt } from '../../types/receipt.js';
import type { DeterministicMemoryMutation } from '../../mutations/index.js';

export interface GetMemoryReceiptInput {
  readonly memoryId: string;
  readonly requestId: string;
}

export interface MemoryStateOperations {
  inspect(input: { readonly memoryId: string }, signal?: AbortSignal): Promise<MemorySnapshot>;
  replay(
    input: DeterministicMemoryMutation,
    signal?: AbortSignal
  ): Promise<MemoryReceipt | undefined>;
  getReceipt(
    input: GetMemoryReceiptInput,
    signal?: AbortSignal
  ): Promise<MemoryReceipt | undefined>;
}

export interface MemoryStateResources {
  readonly memory: MemoryStateOperations;
}
