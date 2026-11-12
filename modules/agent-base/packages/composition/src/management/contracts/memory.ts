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
  CreateInput,
  EntryInput,
  EntryMutationInput,
  EntryPage,
  IngestInput,
  ListInput,
  Mutation,
  ReadContextInput as RetrievalContextInput,
  ReadContextResult as RetrievalContextResult,
  ReceiptInput,
  RetrievalEntry,
  RetrievalMutationOutcome,
  RetrievalReadOutcome,
  RetrievalReceipt,
  RetrievalSpace,
  SearchInput,
  SearchResult,
  SpaceInput,
  UpdateInput,
} from '@print-an-agent/retrieval-memory';
import type { ManagedAgentNamespace } from './namespace.js';

/** Public logical reference; independent of Config revision, runtime generation and storage path. */
export interface AgentMemoryReference {
  readonly agentId: string;
  readonly memoryId: string;
}
export interface MemoryManagementOptions {
  readonly signal?: AbortSignal;
}
export interface ManagedMemoryResult<T> {
  readonly target: AgentMemoryReference;
  /** Native domain result, including its original authority IDs and receipt digest. */
  readonly value: T;
}
export interface MemoryInvocation<T> {
  readonly memoryId: string;
  invoke(signal?: AbortSignal): Promise<T>;
}
export interface MemoryProvisioningRequest<N, I> {
  readonly namespace: ManagedAgentNamespace<N>;
  readonly input: I;
}

/** Named typed factories, not a string/unknown service locator. Acquisition does not transfer ownership. */
export type MemoryOperationProvisioning<N, I, O extends { [K in keyof I]: unknown }> = {
  readonly [K in keyof I]: (
    request: MemoryProvisioningRequest<N, I[K]>,
    options?: MemoryManagementOptions
  ) => MemoryInvocation<O[K]> | Promise<MemoryInvocation<O[K]>>;
};

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
export interface RetrievalMemoryManagementInputs {
  readonly inspect: SpaceInput;
  readonly get: EntryInput;
  readonly getReceipt: ReceiptInput;
  readonly list: ListInput;
  readonly replay: Mutation;
  readonly create: CreateInput;
  readonly ingest: IngestInput;
  readonly update: UpdateInput;
  readonly remove: EntryMutationInput;
  readonly reindex: EntryMutationInput;
  readonly search: SearchInput;
  readonly readContext: RetrievalContextInput;
}
export interface RetrievalMemoryManagementOutputs {
  readonly inspect: RetrievalReadOutcome<RetrievalSpace>;
  readonly get: RetrievalReadOutcome<RetrievalEntry>;
  readonly getReceipt: RetrievalReadOutcome<RetrievalReceipt | undefined>;
  readonly list: RetrievalReadOutcome<EntryPage>;
  readonly replay: RetrievalReceipt | undefined;
  readonly create: RetrievalMutationOutcome;
  readonly ingest: RetrievalMutationOutcome;
  readonly update: RetrievalMutationOutcome;
  readonly remove: RetrievalMutationOutcome;
  readonly reindex: RetrievalMutationOutcome;
  readonly search: RetrievalReadOutcome<SearchResult>;
  readonly readContext: RetrievalReadOutcome<RetrievalContextResult>;
}
export interface RetrievalMemoryManagementCapability<N> {
  readonly retrievalMemoryManagement: Readonly<{
    resolve: MemoryOperationProvisioning<
      N,
      RetrievalMemoryManagementInputs,
      RetrievalMemoryManagementOutputs
    >;
  }>;
}
export type RetrievalMemoryManagementService = {
  readonly [K in Exclude<keyof RetrievalMemoryManagementInputs, 'replay'>]: (
    input: RetrievalMemoryManagementInputs[K] & { readonly agentId: string },
    options?: MemoryManagementOptions
  ) => Promise<ManagedMemoryResult<RetrievalMemoryManagementOutputs[K]>>;
};
