import type { SessionReference } from '@print-an-agent/base-session';

/** Domain-local maintenance. The caller must fence runtime admission before invoking these ports. */
export interface RequestJournalCleanupPort {
  purgeSessionRequests(reference: SessionReference): Promise<void>;
}

/** Preserve terminal records; active records become interrupted failures, never fabricated success. */
export interface RequestJournalRecoveryPort {
  recoverSessionRequests(reference: SessionReference): Promise<void>;
}

export const REQUEST_EXECUTION_INTERRUPTED = 'REQUEST_EXECUTION_INTERRUPTED';
