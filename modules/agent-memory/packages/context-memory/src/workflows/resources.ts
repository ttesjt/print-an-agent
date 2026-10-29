import type {
  ApplyMemoryInput,
  ConfigureMemoryInput,
  CreateMemoryInput,
  ReadContextInput,
  ReadContextResult,
} from '../contracts/inputs.js';
import type { MemoryReceipt, MutationResult } from '../contracts/receipt.js';
import type { MemorySnapshot } from '../contracts/document.js';
import type { DeterministicMemoryMutation } from '../domain/deterministic-request.js';
import { MemoryMutations, type MemoryMutationResources } from '../domain/mutations.js';
import { readMemoryContext } from '../domain/read-context.js';
import { createContextMemoryStateResources } from './state-resources.js';

export interface GetMemoryReceiptInput {
  readonly memoryId: string;
  readonly requestId: string;
}
export interface MemoryOperations {
  inspect(input: { readonly memoryId: string }, signal?: AbortSignal): Promise<MemorySnapshot>;
  replay(
    input: DeterministicMemoryMutation,
    signal?: AbortSignal
  ): Promise<MemoryReceipt | undefined>;
  create(input: CreateMemoryInput, signal?: AbortSignal): Promise<MutationResult>;
  apply(input: ApplyMemoryInput, signal?: AbortSignal): Promise<MutationResult>;
  configure(input: ConfigureMemoryInput, signal?: AbortSignal): Promise<MutationResult>;
  readContext(input: ReadContextInput, signal?: AbortSignal): Promise<ReadContextResult>;
  getReceipt(
    input: GetMemoryReceiptInput,
    signal?: AbortSignal
  ): Promise<MemoryReceipt | undefined>;
}
export interface MemoryWorkflowResources<
  K extends keyof MemoryOperations = keyof MemoryOperations,
> {
  readonly memory: Pick<MemoryOperations, K>;
}

/** Borrow capabilities, never acquire connections or grant Workflows a raw store writer. */
export function createContextMemoryResources(
  options: MemoryMutationResources
): MemoryWorkflowResources {
  const mutations = new MemoryMutations(options);
  return Object.freeze({
    memory: Object.freeze({
      ...createContextMemoryStateResources(options.store).memory,
      create: mutations.create.bind(mutations),
      apply: mutations.apply.bind(mutations),
      configure: mutations.configure.bind(mutations),
      readContext: (input: ReadContextInput, signal?: AbortSignal) =>
        readMemoryContext(options, input, signal),
    }),
  });
}
