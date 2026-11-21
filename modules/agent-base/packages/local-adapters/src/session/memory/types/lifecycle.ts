import type { SessionReference, SessionWriteAuthority } from '@print-an-agent/base-session';
import type { StoredMemorySession } from './state.js';

/** Borrows the Adapter's state; validation and mutation remain synchronous. */
export interface MemorySessionAuthority {
  require(reference: SessionReference): StoredMemorySession;
  assertOpen(reference: SessionReference): void;
  assertWrite(request: SessionReference & SessionWriteAuthority): StoredMemorySession;
}
