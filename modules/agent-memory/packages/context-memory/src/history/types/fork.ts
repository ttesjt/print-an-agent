import type { MemoryVersionReference } from './reference.js';

export interface ForkMemoryInput {
  readonly memoryId: string;
  readonly requestId: string;
  readonly source: MemoryVersionReference;
}
