import { AgentRequestError, type RequestJournalEntry } from '@print-an-agent/base-request';

export function requireJournalOwner(entry: RequestJournalEntry, requestId: string): void {
  if (entry.requestId !== requestId) {
    throw new AgentRequestError(
      'REQUEST_REPLAY_STATE_INVALID',
      `Request Journal entry is owned by request "${entry.requestId}", not "${requestId}".`
    );
  }
}
