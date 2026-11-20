import type { MemoryVersionReference } from '@print-an-agent/context-memory';

export interface SessionMemoryCheckpoint {
  readonly branchId: string;
  readonly input: MemoryVersionReference;
  readonly final: MemoryVersionReference;
  readonly settled: boolean;
}
