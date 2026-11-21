import type { SessionReference, SessionWriteAuthority } from '@print-an-agent/base-session';
import type { AgentResponse } from '../session-aware/types/output.js';

declare const requestIdempotencyKeyBrand: unique symbol;
declare const requestFingerprintBrand: unique symbol;

export type RequestIdempotencyKey = string & {
  readonly [requestIdempotencyKeyBrand]: 'RequestIdempotencyKey';
};

export type RequestFingerprint = string & {
  readonly [requestFingerprintBrand]: 'RequestFingerprint';
};

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

export interface ClaimRequestJournalRequest extends RequestJournalReference, SessionWriteAuthority {
  readonly fingerprint: RequestFingerprint;
  readonly requestId: string;
}

export interface CompleteRequestJournalRequest
  extends RequestJournalReference, SessionWriteAuthority {
  readonly requestId: string;
  readonly response: AgentResponse;
}

export interface FailRequestJournalRequest extends RequestJournalReference, SessionWriteAuthority {
  readonly requestId: string;
  readonly failure: RequestJournalFailure;
}

export interface RequestJournalPort {
  claim(request: ClaimRequestJournalRequest): Promise<RequestJournalClaim>;
  complete(request: CompleteRequestJournalRequest): Promise<CompletedRequestJournalEntry>;
  fail(request: FailRequestJournalRequest): Promise<RequestJournalEntry>;
}

export interface InspectableRequestJournalPort extends RequestJournalPort {
  inspect(reference: RequestJournalReference): Promise<RequestJournalEntry | undefined>;
}
