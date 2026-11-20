import type { ApplyMemoryInput } from '@print-an-agent/context-memory';
import type { MemoryJournal } from '../journal.js';
import type { ContextMemoryWorkflows } from '../types/workflows.js';

export interface RuntimeMemoryMutation {
  journal: MemoryJournal;
  memory: ContextMemoryWorkflows;
  authorityId: string;
  turnId?: string;
  branchId: string;
  input: ApplyMemoryInput;
  signal: AbortSignal;
}
