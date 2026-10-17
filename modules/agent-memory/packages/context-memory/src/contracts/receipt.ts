import type { JsonObject, JsonValue, MemoryState } from './document.js';

export type MemoryOperation = 'create' | 'configure' | 'apply' | 'observe' | 'edit' | 'compact';
/** Business identity is distinct from Workflow Run identity and internal attempt counts. */
export interface MutationRequest {
  readonly memoryId: string;
  readonly requestId: string;
  readonly operation: MemoryOperation;
  readonly input: JsonValue;
}
export interface CommandOutcome {
  readonly commandIndex: number;
  readonly outcome: 'added' | 'updated' | 'removed' | 'ignored' | 'unchanged';
  readonly itemId?: string;
}
export interface MemoryChanges {
  readonly addedItemIds: readonly string[];
  readonly updatedItemIds: readonly string[];
  readonly removedItemIds: readonly string[];
}
export interface MemoryReceipt {
  readonly memoryId: string;
  readonly requestId: string;
  readonly operation: MemoryOperation;
  readonly inputDigest: string;
  readonly status: 'committed' | 'unchanged';
  readonly previousRevision: number | null;
  readonly revision: number;
  readonly changes: MemoryChanges;
  readonly commandOutcomes: readonly CommandOutcome[];
}
export type MutationResult =
  | { readonly status: 'committed' | 'unchanged'; readonly receipt: MemoryReceipt }
  | { readonly status: 'skipped'; readonly reason: string };
export type CommitStatus =
  | { readonly status: 'not-committed' }
  | { readonly status: 'committed'; readonly receipt: MemoryReceipt }
  | { readonly status: 'unknown'; readonly memoryId: string; readonly requestId: string };

/** Trusted persistence input. Only the domain boundary produces this for Workflow consumers. */
export interface StoreCommit {
  readonly request: MutationRequest;
  /** null means conditional creation; an existing identity must not be overwritten. */
  readonly expectedRevision: number | null;
  readonly state: MemoryState;
  readonly commandOutcomes: readonly CommandOutcome[];
}

export interface MemoryErrorOptions extends ErrorOptions {
  readonly memoryId?: string;
  readonly details?: JsonObject;
  readonly commit?: CommitStatus;
}
