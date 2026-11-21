import type { SessionReference } from '@print-an-agent/base-session';
import type { AgentResponse } from '../../types/output.js';
import type { RequestFingerprint, RequestIdempotencyKey } from './identity.js';
export interface RequestJournalReference extends SessionReference {
  readonly idempotencyKey: RequestIdempotencyKey;
}

export interface RequestJournalFailure {
  readonly code: string;
  readonly message: string;
}

interface RequestJournalEntryBase extends RequestJournalReference {
  readonly fingerprint: RequestFingerprint;
  readonly requestId: string;
  readonly startedAt: number;
}

export interface ActiveRequestJournalEntry extends RequestJournalEntryBase {
  readonly status: 'active';
}

export interface CompletedRequestJournalEntry extends RequestJournalEntryBase {
  readonly status: 'completed';
  readonly response: AgentResponse;
  readonly finishedAt: number;
}

export interface FailedRequestJournalEntry extends RequestJournalEntryBase {
  readonly status: 'failed';
  readonly failure: RequestJournalFailure;
  readonly finishedAt: number;
}

export type RequestJournalEntry =
  | ActiveRequestJournalEntry
  | CompletedRequestJournalEntry
  | FailedRequestJournalEntry;

export type RequestJournalClaim =
  | Readonly<{ status: 'claimed'; entry: ActiveRequestJournalEntry }>
  | Readonly<{ status: 'existing'; entry: RequestJournalEntry }>;
