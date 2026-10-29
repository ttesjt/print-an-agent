import { AgentSessionError } from '../errors.js';
import { normalizeSessionReference } from '../lifecycle/validation.js';
import type {
  SessionMemoryRecord,
  SessionMemoryRecordKey,
  WriteSessionMemoryRecord,
} from './contracts.js';

export function memoryRecordKey(input: SessionMemoryRecordKey): SessionMemoryRecordKey {
  const reference = normalizeSessionReference({
    agentId: input.agentId,
    sessionId: input.sessionId,
  });
  if (
    !['binding', 'turn', 'mutation', 'navigation'].includes(input.kind) ||
    typeof input.id !== 'string' ||
    !input.id.isWellFormed() ||
    input.id.trim().length === 0 ||
    input.id.includes('\0')
  )
    throw new AgentSessionError('SESSION_MEMORY_INVALID', 'Invalid Memory coordination key.');
  return { ...reference, kind: input.kind, id: input.id };
}

export function decideMemoryRecord(
  current: SessionMemoryRecord | undefined,
  input: WriteSessionMemoryRecord
): SessionMemoryRecord {
  const key = memoryRecordKey(input);
  if (
    current !== undefined &&
    (current.agentId !== key.agentId ||
      current.sessionId !== key.sessionId ||
      current.kind !== key.kind ||
      current.id !== key.id)
  )
    throw new AgentSessionError('SESSION_MEMORY_INVALID', 'Memory coordination identity differs.');
  if (
    (input.expectedRevision !== null &&
      (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1)) ||
    typeof input.settled !== 'boolean' ||
    typeof input.value !== 'string' ||
    !input.value.isWellFormed()
  )
    throw new AgentSessionError('SESSION_MEMORY_INVALID', 'Invalid Memory coordination record.');
  try {
    const value: unknown = JSON.parse(input.value);
    if (value === null || typeof value !== 'object' || Array.isArray(value))
      throw new Error('Record must be an object');
  } catch (cause) {
    throw new AgentSessionError('SESSION_MEMORY_INVALID', 'Invalid Memory coordination encoding.', {
      cause,
    });
  }
  if ((current?.revision ?? null) !== input.expectedRevision)
    throw new AgentSessionError('SESSION_MEMORY_CONFLICT', 'Memory coordination revision changed.');
  const revision = (current?.revision ?? 0) + 1;
  if (!Number.isSafeInteger(revision))
    throw new AgentSessionError(
      'SESSION_MEMORY_INVALID',
      'Memory coordination revision exhausted.'
    );
  return Object.freeze({ ...key, revision, settled: input.settled, value: input.value });
}
