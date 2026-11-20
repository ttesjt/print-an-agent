import { normalizeSessionReference } from '../contracts/index.js';
import { AgentSessionError } from '../errors.js';
import { SESSION_MEMORY_RECORD_KINDS } from './record-kinds.js';
import type { SessionMemoryRecordKey } from './types/records.js';

export function memoryRecordKey(input: SessionMemoryRecordKey): SessionMemoryRecordKey {
  const reference = normalizeSessionReference({
    agentId: input.agentId,
    sessionId: input.sessionId,
  });
  if (
    !SESSION_MEMORY_RECORD_KINDS.includes(input.kind) ||
    typeof input.id !== 'string' ||
    !input.id.isWellFormed() ||
    input.id.trim().length === 0 ||
    input.id.includes('\0')
  )
    throw new AgentSessionError('SESSION_MEMORY_INVALID', 'Invalid Memory coordination key.');
  return { ...reference, kind: input.kind, id: input.id };
}
