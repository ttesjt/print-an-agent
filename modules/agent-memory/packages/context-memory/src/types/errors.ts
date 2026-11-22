import type { JsonObject } from './json.js';
import type { CommitStatus } from './receipt.js';

export interface MemoryErrorOptions extends ErrorOptions {
  readonly memoryId?: string;
  readonly details?: JsonObject;
  readonly commit?: CommitStatus;
}
