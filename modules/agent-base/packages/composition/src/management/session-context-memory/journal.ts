import {
  AgentSessionError,
  type SessionMemoryPort,
  type SessionMemoryRecord,
  type SessionMemoryRecordKind,
  type SessionReference,
  type SessionWriteAuthority,
} from '@print-an-agent/base-session';
import {
  parseMemoryVersionReference,
  type MemoryVersionReference,
} from '@print-an-agent/context-memory';

export function memoryObject(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new AgentSessionError('SESSION_MEMORY_INVALID', 'Invalid Memory coordination payload.');
  return value as Record<string, unknown>;
}
export function memoryString(value: unknown): string {
  if (typeof value !== 'string' || !value.isWellFormed() || !value.trim() || value.includes('\0'))
    throw new AgentSessionError('SESSION_MEMORY_INVALID', 'Invalid Memory coordination identity.');
  return value;
}
export function payload(record: SessionMemoryRecord): Record<string, unknown> {
  const value = memoryObject(JSON.parse(record.value) as unknown);
  if (value.format !== 1)
    throw new AgentSessionError('SESSION_MEMORY_INVALID', 'Unknown Memory coordination format.');
  return value;
}
export function version(value: unknown): MemoryVersionReference {
  return parseMemoryVersionReference(value);
}

/** Application-owned journal access over explicit borrowed Session capabilities. */
export class MemoryJournal {
  constructor(
    readonly session: SessionMemoryPort,
    readonly reference: SessionReference & SessionWriteAuthority
  ) {}
  read(kind: SessionMemoryRecordKind, id: string) {
    return this.session.readMemoryRecord({ ...this.reference, kind, id });
  }
  async put(
    kind: SessionMemoryRecordKind,
    id: string,
    value: Readonly<Record<string, unknown>>,
    settled: boolean,
    current?: SessionMemoryRecord
  ) {
    const old = await this.read(kind, id);
    const encoded = JSON.stringify({ format: 1, ...value });
    if (current !== undefined && old?.value === encoded && old.settled === settled) return old;
    if (current === undefined ? old !== undefined : current.revision !== old?.revision)
      throw new AgentSessionError(
        'SESSION_MEMORY_CONFLICT',
        'Memory coordination changed after it was read.'
      );
    return this.session.writeMemoryRecord({
      ...this.reference,
      kind,
      id,
      // Absence of a caller-captured record means conditional creation, never upsert.
      expectedRevision: current?.revision ?? null,
      settled,
      value: encoded,
    });
  }
}
