import { parseAgentId } from '@ta-agent/base-identity';
import { parseSessionId } from '@ta-agent/base-session';
import { AgentRequestError } from '../../errors.js';
import type {
  ActiveRequestJournalEntry,
  ClaimRequestJournalRequest,
  CompleteRequestJournalRequest,
  CompletedRequestJournalEntry,
  FailRequestJournalRequest,
  InspectableRequestJournalPort,
  RequestJournalClaim,
  RequestJournalEntry,
  RequestJournalReference,
} from '../contracts.js';
import {
  defineRequestJournalFailure,
  parseRequestFingerprint,
  parseRequestIdempotencyKey,
  parseRequestJournalRequestId,
} from '../identifiers.js';
import { decodeAgentResponse, encodeAgentResponse } from '../response-codec.js';

function journalKey(reference: RequestJournalReference): string {
  return `${reference.agentId}\u0000${reference.sessionId}\u0000${reference.idempotencyKey}`;
}

function normalizeReference(reference: RequestJournalReference): RequestJournalReference {
  return Object.freeze({
    agentId: parseAgentId(reference.agentId),
    sessionId: parseSessionId(reference.sessionId),
    idempotencyKey: parseRequestIdempotencyKey(reference.idempotencyKey),
  });
}

function readClock(clock: () => number): number {
  const timestamp = clock();
  if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
    throw new AgentRequestError(
      'REQUEST_REPLAY_CONFIGURATION_INVALID',
      'Request Journal clock must return a non-negative safe integer timestamp.'
    );
  }
  return timestamp;
}

function cloneEntry(entry: ActiveRequestJournalEntry): ActiveRequestJournalEntry;
function cloneEntry(entry: CompletedRequestJournalEntry): CompletedRequestJournalEntry;
function cloneEntry(entry: RequestJournalEntry): RequestJournalEntry;
function cloneEntry(entry: RequestJournalEntry): RequestJournalEntry {
  if (entry.status === 'completed') {
    return Object.freeze({
      ...entry,
      response: decodeAgentResponse(encodeAgentResponse(entry.response)),
    });
  }
  if (entry.status === 'failed') {
    return Object.freeze({ ...entry, failure: Object.freeze({ ...entry.failure }) });
  }
  return Object.freeze({ ...entry });
}

export class MemoryRequestJournalAdapter implements InspectableRequestJournalPort {
  readonly #entries = new Map<string, RequestJournalEntry>();
  readonly #clock: () => number;

  constructor(clock: () => number = Date.now) {
    this.#clock = clock;
  }

  claim(request: ClaimRequestJournalRequest): Promise<RequestJournalClaim> {
    return Promise.resolve().then(() => {
      const reference = normalizeReference(request);
      const fingerprint = parseRequestFingerprint(request.fingerprint);
      const requestId = parseRequestJournalRequestId(request.requestId);
      const key = journalKey(reference);
      const existing = this.#entries.get(key);
      if (existing !== undefined) {
        if (existing.fingerprint !== fingerprint) {
          throw new AgentRequestError(
            'REQUEST_REPLAY_CONFLICT',
            `Idempotency key "${reference.idempotencyKey}" is already bound to a different request.`
          );
        }
        return Object.freeze({ status: 'existing', entry: cloneEntry(existing) });
      }

      const entry: ActiveRequestJournalEntry = Object.freeze({
        ...reference,
        status: 'active',
        fingerprint,
        requestId,
        startedAt: readClock(this.#clock),
      });
      this.#entries.set(key, entry);
      return Object.freeze({ status: 'claimed', entry: cloneEntry(entry) });
    });
  }

  complete(request: CompleteRequestJournalRequest): Promise<CompletedRequestJournalEntry> {
    return Promise.resolve().then(() => {
      const reference = normalizeReference(request);
      const requestId = parseRequestJournalRequestId(request.requestId);
      const response = decodeAgentResponse(encodeAgentResponse(request.response));
      const entry = this.#requireEntry(reference);
      this.#requireOwner(entry, requestId);
      if (entry.status !== 'active') {
        throw new AgentRequestError(
          'REQUEST_REPLAY_STATE_INVALID',
          `Request Journal entry cannot complete from state "${entry.status}".`
        );
      }
      if (response.requestId !== requestId || response.sessionId !== reference.sessionId) {
        throw new AgentRequestError(
          'REQUEST_REPLAY_STATE_INVALID',
          'Request Journal response does not match the active request authority.'
        );
      }
      const completed: CompletedRequestJournalEntry = Object.freeze({
        ...entry,
        status: 'completed',
        response,
        finishedAt: readClock(this.#clock),
      });
      this.#entries.set(journalKey(reference), completed);
      return cloneEntry(completed);
    });
  }

  fail(request: FailRequestJournalRequest): Promise<RequestJournalEntry> {
    return Promise.resolve().then(() => {
      const reference = normalizeReference(request);
      const requestId = parseRequestJournalRequestId(request.requestId);
      const failure = defineRequestJournalFailure(request.failure);
      const entry = this.#requireEntry(reference);
      this.#requireOwner(entry, requestId);
      if (entry.status !== 'active') return cloneEntry(entry);

      const failed: RequestJournalEntry = Object.freeze({
        ...entry,
        status: 'failed',
        failure,
        finishedAt: readClock(this.#clock),
      });
      this.#entries.set(journalKey(reference), failed);
      return cloneEntry(failed);
    });
  }

  inspect(referenceInput: RequestJournalReference): Promise<RequestJournalEntry | undefined> {
    return Promise.resolve().then(() => {
      const reference = normalizeReference(referenceInput);
      const entry = this.#entries.get(journalKey(reference));
      return entry === undefined ? undefined : cloneEntry(entry);
    });
  }

  #requireEntry(reference: RequestJournalReference): RequestJournalEntry {
    const entry = this.#entries.get(journalKey(reference));
    if (entry === undefined) {
      throw new AgentRequestError(
        'REQUEST_REPLAY_NOT_FOUND',
        `Request Journal entry "${reference.idempotencyKey}" does not exist.`
      );
    }
    return entry;
  }

  #requireOwner(entry: RequestJournalEntry, requestId: string): void {
    if (entry.requestId !== requestId) {
      throw new AgentRequestError(
        'REQUEST_REPLAY_STATE_INVALID',
        `Request Journal entry is owned by request "${entry.requestId}", not "${requestId}".`
      );
    }
  }
}
