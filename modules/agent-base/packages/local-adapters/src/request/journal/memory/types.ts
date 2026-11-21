import type { SessionReference, SessionWriteAuthority } from '@print-an-agent/base-session';

export type MemoryJournalExecutionGuard = (
  request: SessionReference & SessionWriteAuthority
) => void;

export interface MemoryJournalCoordination {
  bindExecution(guard: MemoryJournalExecutionGuard): void;
  checkpoint(reference: SessionReference): () => void;
}
