import type { InspectableRequestJournalPort } from '@print-an-agent/base-request';
import type {
  PurgeSessionInput,
  RecoverSessionExecutionsInput,
  SessionExecutionFence,
} from '@print-an-agent/base-session';
import type { LocalLifecycleSessionPort } from '../../session/index.js';

/** Explicit Session + Request Journal scope; not substitutable for Session-only domain ports. */
export interface CoordinatedSessionMaintenance {
  /** Atomically deletes the retired Session aggregate and its Journal records, or neither. */
  purgeSessionPersistence(input: PurgeSessionInput): Promise<void>;
  /** Keeps admission fenced until both domains settle; preserves completed records. */
  recoverSessionPersistence(input: RecoverSessionExecutionsInput): Promise<SessionExecutionFence>;
}

/** A concrete coordinated profile, not a universal transaction or adapter registry. */
export interface CoordinatedSessionPersistence {
  readonly session: LocalLifecycleSessionPort;
  readonly requestJournal: InspectableRequestJournalPort;
  /** Atomic Session + Journal scope; distinct from Session-only management. */
  readonly maintenance: CoordinatedSessionMaintenance;
}
