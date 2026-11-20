import type { SessionReference } from '@print-an-agent/base-session';
import { memoryString, payload, version } from './journal.js';
import type { SessionMemoryCheckpoint } from './types/checkpoint.js';
import type { SessionContextMemoryOptions } from './types/options.js';

export async function readSessionMemoryCheckpoint(
  options: SessionContextMemoryOptions,
  reference: SessionReference,
  turnId: string
): Promise<SessionMemoryCheckpoint | undefined> {
  const row = await options.session.readMemoryRecord({
    ...reference,
    kind: 'turn',
    id: turnId,
  });
  if (row === undefined) return undefined;
  const value = payload(row);
  return {
    branchId: memoryString(value.branchId),
    input: version(value.input),
    final: version(value.final),
    settled: row.settled,
  };
}
