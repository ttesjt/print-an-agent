export const SESSION_MEMORY_RECORD_KINDS = ['binding', 'turn', 'mutation', 'navigation'] as const;
export type SessionMemoryRecordKind = (typeof SESSION_MEMORY_RECORD_KINDS)[number];
