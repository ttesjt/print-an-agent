import { AgentSessionError, type SessionMemoryRecord } from '@print-an-agent/base-session';
import {
  assertReceiptMatches,
  requestDigest,
  type MemoryReceipt,
} from '@print-an-agent/context-memory';
import { SessionMemoryCommitError } from '../errors.js';
import { MemoryJournal, memoryString, payload, version } from '../journal.js';
import { applyInput } from './input.js';

export async function recordMemoryReceipt(
  journal: MemoryJournal,
  row: SessionMemoryRecord,
  receipt: MemoryReceipt
) {
  const data = payload(row);
  const original = applyInput(data.input);
  assertReceiptMatches(receipt, original.request);
  if (data.inputDigest !== requestDigest(original.request))
    throw new AgentSessionError('SESSION_MEMORY_INVALID', 'Memory intent digest is invalid.');
  // A crash between these writes is recoverable: keep the intent pending until its checkpoint is written.
  if (data.scope !== 'management') {
    const turnId = memoryString(data.turnId);
    const cp = await journal.read('turn', turnId);
    if (cp === undefined) throw new SessionMemoryCommitError({ status: 'committed', receipt });
    const state = payload(cp);
    const previous = version(state.final);
    if (previous.memoryId !== receipt.memoryId)
      throw new AgentSessionError(
        'SESSION_MEMORY_INVALID',
        'Receipt does not belong to this Turn binding.'
      );
    if (receipt.revision > previous.revision)
      await journal.put(
        'turn',
        turnId,
        { ...state, final: { memoryId: receipt.memoryId, revision: receipt.revision } },
        false,
        cp
      );
  }
  await journal.put('mutation', row.id, { ...data, receipt }, data.cleanupPending !== true, row);
}
