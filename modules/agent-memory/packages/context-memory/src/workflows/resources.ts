import type {
  ApplyMemoryInput,
  ConfigureMemoryInput,
  CreateMemoryInput,
  ReadContextInput,
  ReadContextResult,
} from '../contracts/inputs.js';
import type { MemoryReceipt, MutationResult } from '../contracts/receipt.js';
import { MemoryMutations, type MemoryMutationResources } from '../domain/mutations.js';
import { readMemoryContext } from '../domain/read-context.js';
import { assertMemoryNotAborted, ContextMemoryError } from '../errors.js';
import { identity, jsonValue, keys, record } from '../validation/value.js';
import { parseMemoryReceipt } from '../validation/receipt.js';

export interface GetMemoryReceiptInput {
  readonly memoryId: string;
  readonly requestId: string;
}
export interface MemoryOperations {
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
      create: mutations.create.bind(mutations),
      apply: mutations.apply.bind(mutations),
      configure: mutations.configure.bind(mutations),
      readContext: (input: ReadContextInput, signal?: AbortSignal) =>
        readMemoryContext(options, input, signal),
      async getReceipt(input: GetMemoryReceiptInput, signal?: AbortSignal) {
        assertMemoryNotAborted(signal);
        const data = record(jsonValue(input), 'receipt lookup');
        keys(data, ['memoryId', 'requestId']);
        const memoryId = identity(data.memoryId, 'memoryId');
        const requestId = identity(data.requestId, 'requestId');
        try {
          const value = await options.store.getReceipt(memoryId, requestId, signal);
          if (value === undefined) {
            assertMemoryNotAborted(signal);
            return undefined;
          }
          const receipt = parseMemoryReceipt(value);
          if (receipt.memoryId !== memoryId || receipt.requestId !== requestId)
            throw new Error('Receipt scope mismatch.');
          return receipt;
        } catch (cause) {
          assertMemoryNotAborted(signal);
          throw new ContextMemoryError('STORAGE_FAILED', 'Memory receipt could not be read.', {
            memoryId,
            cause,
          });
        }
      },
    }),
  });
}
