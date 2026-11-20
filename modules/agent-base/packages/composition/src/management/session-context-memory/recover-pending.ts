import {
  AgentSessionError,
  supportsSessionMemoryNavigation,
  type SessionMemoryRecord,
  type SessionReference,
} from '@print-an-agent/base-session';
import { MemoryJournal, payload } from './journal.js';
import { recoverMemoryMutation } from './mutations/index.js';
import { isSettledNavigationRejection, publishMemoryNavigation } from './navigation/index.js';
import type { SessionContextMemoryOptions } from './types/options.js';

export async function recoverPendingSessionMemory(
  options: SessionContextMemoryOptions,
  authorityId: string,
  reference: SessionReference,
  signal: AbortSignal,
  completeBinding: (
    journal: MemoryJournal,
    binding: SessionMemoryRecord,
    signal: AbortSignal
  ) => Promise<SessionMemoryRecord>
): Promise<void> {
  const journal = new MemoryJournal(options.session, reference);
  // Each batch is bounded by the port. Loop across settled batches, never infer absence of a receipt.
  while (true) {
    let pending = await options.session.listPendingMemoryRecords(reference);
    if (pending.length === 0) return;
    signal.throwIfAborted();
    for (const row of pending) {
      if (row.kind === 'binding') await completeBinding(journal, row, signal);
      if (row.kind === 'navigation') {
        const session = options.session;
        if (!supportsSessionMemoryNavigation(session))
          throw new AgentSessionError(
            'SESSION_MEMORY_NOT_CONFIGURED',
            'Atomic navigation capability is missing.'
          );
        try {
          await publishMemoryNavigation({ ...options, session }, journal, row, signal);
        } catch (cause) {
          const settled = await journal.read('navigation', row.id);
          if (settled === undefined || !isSettledNavigationRejection(settled, cause)) throw cause;
          // A durable rejection is a terminal navigation outcome, not unresolved work.
        }
      }
    }
    for (const row of pending)
      if (row.kind === 'mutation')
        await recoverMemoryMutation(journal, row, options.memory, authorityId, signal);
    pending = await options.session.listPendingMemoryRecords(reference);
    if (
      pending.some(
        (row) => row.kind === 'mutation' || row.kind === 'binding' || row.kind === 'navigation'
      )
    )
      continue;
    for (const row of pending)
      if (row.kind === 'turn') await journal.put('turn', row.id, payload(row), true, row);
  }
}
