import type { SessionReference } from '../types.js';
import type { SessionWriteAuthority } from '../lifecycle/execution.js';
import type {
  ApplySessionNavigationRequest,
  AppliedSessionNavigation,
} from '../navigation/contracts.js';

/** Store-scoped reference. The persisted binding identifies the owning authority. */
export interface SessionMemoryVersion {
  readonly memoryId: string;
  readonly revision: number;
}

export type SessionMemoryRecordKind = 'binding' | 'turn' | 'mutation' | 'navigation';
export interface SessionMemoryRecordKey extends SessionReference {
  readonly kind: SessionMemoryRecordKind;
  readonly id: string;
}
/** Session-owned coordination journal, not a second copy of Memory content. */
export interface SessionMemoryRecord extends SessionMemoryRecordKey {
  readonly revision: number;
  readonly settled: boolean;
  /** Versioned domain encoding; adapters preserve it without interpreting Memory internals. */
  readonly value: string;
}
export interface WriteSessionMemoryRecord extends SessionMemoryRecordKey, SessionWriteAuthority {
  readonly expectedRevision: number | null;
  readonly settled: boolean;
  readonly value: string;
}
export interface SessionMemoryPort {
  readMemoryRecord(key: SessionMemoryRecordKey): Promise<SessionMemoryRecord | undefined>;
  writeMemoryRecord(input: WriteSessionMemoryRecord): Promise<SessionMemoryRecord>;
  /** Bounded unresolved work only; settled history is read by its exact key. */
  listPendingMemoryRecords(reference: SessionReference): Promise<readonly SessionMemoryRecord[]>;
}

/** Atomically publishes Session navigation, its branch binding and its coordination receipt. */
export interface PublishSessionMemoryNavigation extends ApplySessionNavigationRequest {
  readonly intentId: string;
  readonly expectedIntentRevision: number;
  readonly binding?: Readonly<{ id: string; value: string }>;
}
export interface SessionMemoryNavigationPort extends SessionMemoryPort {
  publishMemoryNavigation(input: PublishSessionMemoryNavigation): Promise<AppliedSessionNavigation>;
}
export function supportsSessionMemoryNavigation(
  value: object
): value is SessionMemoryNavigationPort {
  return (
    supportsSessionMemory(value) &&
    'publishMemoryNavigation' in value &&
    typeof value.publishMemoryNavigation === 'function'
  );
}

export function supportsSessionMemory(value: object): value is SessionMemoryPort {
  return (
    'readMemoryRecord' in value &&
    typeof value.readMemoryRecord === 'function' &&
    'writeMemoryRecord' in value &&
    typeof value.writeMemoryRecord === 'function' &&
    'listPendingMemoryRecords' in value &&
    typeof value.listPendingMemoryRecords === 'function'
  );
}
