import type {
  CreateInput,
  EntryInput,
  EntryMutationInput,
  EntryPage,
  IngestInput,
  ListInput,
  Mutation,
  ReceiptInput,
  ReadContextInput as RetrievalContextInput,
  ReadContextResult as RetrievalContextResult,
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
import type {
  MemoryManagementOptions,
  MemoryOperationProvisioning,
} from '../../types/provisioning.js';
import type { ManagedMemoryResult } from '../../types/reference.js';

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
