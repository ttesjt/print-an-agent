import { randomUUID } from 'node:crypto';
import type { MemorySessionAdapterOptions } from '../types/options.js';
import type { MemorySessionState } from '../types/state.js';

export function createMemorySessionState(options: MemorySessionAdapterOptions): MemorySessionState {
  return {
    sessions: new Map(),
    sessionIds: new Set(),
    createSessionId: options.createSessionId ?? randomUUID,
    createBranchId: options.createBranchId ?? randomUUID,
    clock: options.clock ?? Date.now,
  };
}
