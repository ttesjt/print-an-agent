import type { SessionReference, SessionWriteAuthority } from '@print-an-agent/base-session';

export interface MemorySessionCoordination {
  assertWrite(this: void, request: SessionReference & SessionWriteAuthority): void;
  checkpoint(this: void, reference: SessionReference): () => void;
  fenceRecovery(this: void, reference: SessionReference): void;
}
