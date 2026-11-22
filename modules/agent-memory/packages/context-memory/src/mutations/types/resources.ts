import type { MemoryItem } from '../../types/document.js';
import type { MemoryConfigInput } from '../../document/index.js';
import type { MemoryStore } from '../../persistence/index.js';
import type { MemoryMeter } from '../../measurement/index.js';

export interface MemoryMutationResources {
  readonly store: MemoryStore;
  readonly meter: MemoryMeter;
  readonly defaults?: MemoryConfigInput;
  readonly createItemId?: () => string;
  /** Optional host-specific content policy; never substitutes for core validation. */
  readonly validateItem?: (item: MemoryItem, signal: AbortSignal) => void | Promise<void>;
}
