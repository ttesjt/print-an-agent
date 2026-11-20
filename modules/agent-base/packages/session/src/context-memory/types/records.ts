import type { SessionReference } from '../../contracts/index.js';
import type { SessionWriteAuthority } from '../../lifecycle/index.js';
import type { SessionMemoryRecordKind } from '../record-kinds.js';

/** Store-scoped reference. The persisted binding identifies the owning authority. */
export interface SessionMemoryVersion {
  readonly memoryId: string;
  readonly revision: number;
}

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
