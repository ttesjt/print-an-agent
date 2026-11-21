import type { SessionWriteAuthority } from '@print-an-agent/base-session';
import type { AgentResponse } from '../../types/output.js';
import type { RequestFingerprint } from './identity.js';
import type {
  CompletedRequestJournalEntry,
  RequestJournalClaim,
  RequestJournalEntry,
  RequestJournalFailure,
  RequestJournalReference,
} from './records.js';
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
