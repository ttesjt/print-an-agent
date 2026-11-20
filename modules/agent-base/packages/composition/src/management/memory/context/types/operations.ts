import type {
  ApplyMemoryInput,
  ConfigureMemoryInput,
  CreateMemoryInput,
  DeterministicMemoryMutation,
  GetMemoryReceiptInput,
  MemoryReceipt,
  MemorySnapshot,
  MutationResult,
  ReadContextInput,
  ReadContextResult,
} from '@print-an-agent/context-memory';
import type {
  MemoryManagementOptions,
  MemoryOperationProvisioning,
} from '../../types/provisioning.js';
import type { ManagedMemoryResult } from '../../types/reference.js';

export type ContextMemoryReplayInput = DeterministicMemoryMutation;
export interface ContextMemoryManagementInputs {
  readonly inspect: { readonly memoryId: string };
  readonly getReceipt: GetMemoryReceiptInput;
  readonly replay: ContextMemoryReplayInput;
  readonly create: CreateMemoryInput;
  readonly apply: ApplyMemoryInput;
  readonly configure: ConfigureMemoryInput;
  readonly readContext: ReadContextInput;
}
export interface ContextMemoryManagementOutputs {
  readonly inspect: MemorySnapshot | undefined;
  readonly getReceipt: MemoryReceipt | undefined;
  readonly replay: MemoryReceipt | undefined;
  readonly create: MutationResult;
  readonly apply: MutationResult;
  readonly configure: MutationResult;
  readonly readContext: ReadContextResult | undefined;
}
export interface ContextMemoryManagementCapability<N> {
  readonly contextMemoryManagement: Readonly<{
    resolve: MemoryOperationProvisioning<
      N,
      ContextMemoryManagementInputs,
      ContextMemoryManagementOutputs
    >;
  }>;
}
export type ContextMemoryManagementService = {
  readonly [K in Exclude<keyof ContextMemoryManagementInputs, 'replay'>]: (
    input: ContextMemoryManagementInputs[K] & { readonly agentId: string },
    options?: MemoryManagementOptions
  ) => Promise<ManagedMemoryResult<ContextMemoryManagementOutputs[K]>>;
};
