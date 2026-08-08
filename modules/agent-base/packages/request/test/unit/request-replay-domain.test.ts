import { describe, expect, it } from 'vitest';
import {
  AgentRequestError,
  createRequestFingerprint,
  MemoryRequestJournalAdapter,
  parseRequestFingerprint,
  parseRequestIdempotencyKey,
} from '../../src/index.js';
import { decodeAgentResponse, encodeAgentResponse } from '../../src/replay/response-codec.js';
import { journalReference, journalResponse } from '../support/request-journal-contract.js';

function expectRequestError(action: () => unknown, code: AgentRequestError['code']): void {
  let received: unknown;
  try {
    action();
  } catch (error: unknown) {
    received = error;
  }
  expect(received).toEqual(expect.objectContaining<Partial<AgentRequestError>>({ code }));
}

describe('Request replay domain', () => {
  it('validates idempotency keys and versioned SHA-256 fingerprints', () => {
    for (const invalid of ['', 'contains space', '-starts-with-separator', 'x'.repeat(129)]) {
      expectRequestError(
        () => parseRequestIdempotencyKey(invalid),
        'REQUEST_IDEMPOTENCY_KEY_INVALID'
      );
    }
    expectRequestError(
      () => parseRequestFingerprint('not-a-sha256-digest'),
      'REQUEST_REPLAY_FINGERPRINT_INVALID'
    );
    expectRequestError(
      () => parseRequestFingerprint('a'.repeat(64)),
      'REQUEST_REPLAY_FINGERPRINT_INVALID'
    );
    expectRequestError(
      () => parseRequestFingerprint(`request-v2:sha256:${'a'.repeat(64)}`),
      'REQUEST_REPLAY_FINGERPRINT_INVALID'
    );
    expectRequestError(
      () => parseRequestFingerprint(`request-v1:sha512:${'a'.repeat(64)}`),
      'REQUEST_REPLAY_FINGERPRINT_INVALID'
    );

    const first = createRequestFingerprint({ message: 'private request text' });
    expect(first).toBe(
      'request-v1:sha256:2ccd8ae27b673c68b0004eb5b9591ed295a2e7240737f24497c6d492ba1ac62b'
    );
    expect(first).toBe(createRequestFingerprint({ message: 'private request text' }));
    expect(first).not.toBe(createRequestFingerprint({ message: 'different request text' }));
    expect(first).not.toContain('private');

    for (const invalidManifest of [
      'private request text',
      { message: 1 },
      { message: 'private request text', model: 'mutable-default' },
    ]) {
      expectRequestError(
        () => Reflect.apply(createRequestFingerprint, undefined, [invalidManifest]),
        'REQUEST_REPLAY_FINGERPRINT_INVALID'
      );
    }
  });

  it('validates request ownership, failure views, and clocks at adapter boundaries', async () => {
    const reference = journalReference();
    const journal = new MemoryRequestJournalAdapter(() => -1);
    await expect(
      journal.claim({
        ...reference,
        fingerprint: createRequestFingerprint({ message: 'hello' }),
        requestId: 'request-1',
      })
    ).rejects.toEqual(
      expect.objectContaining<Partial<AgentRequestError>>({
        code: 'REQUEST_REPLAY_CONFIGURATION_INVALID',
      })
    );

    const validJournal = new MemoryRequestJournalAdapter(() => 1);
    await expect(
      validJournal.claim({
        ...reference,
        fingerprint: createRequestFingerprint({ message: 'hello' }),
        requestId: 'invalid request id',
      })
    ).rejects.toEqual(
      expect.objectContaining<Partial<AgentRequestError>>({
        code: 'REQUEST_REPLAY_REQUEST_ID_INVALID',
      })
    );
    await validJournal.claim({
      ...reference,
      fingerprint: createRequestFingerprint({ message: 'hello' }),
      requestId: 'request-1',
    });
    await expect(
      validJournal.fail({
        ...reference,
        requestId: 'request-1',
        failure: { code: 'INVALID CODE', message: '' },
      })
    ).rejects.toEqual(
      expect.objectContaining<Partial<AgentRequestError>>({
        code: 'REQUEST_REPLAY_FAILURE_INVALID',
      })
    );
  });

  it('round-trips an immutable versioned response wire value', () => {
    const original = journalResponse('request-1');
    const decoded = decodeAgentResponse(encodeAgentResponse(original));

    expect(decoded).toEqual(original);
    expect(Object.isFrozen(decoded)).toBe(true);
    expect(Object.isFrozen(decoded.message.usage)).toBe(true);
    expect(Object.isFrozen(decoded.toolRun.records)).toBe(true);
  });

  it('decodes a legacy linear response onto the default Session branch', () => {
    const original = journalResponse('legacy-request');
    const legacyResponse = {
      requestId: original.requestId,
      sessionId: original.sessionId,
      message: original.message,
      toolRun: original.toolRun,
    };

    expect(
      decodeAgentResponse(JSON.stringify({ schemaVersion: 1, response: legacyResponse }))
    ).toEqual(original);
  });

  it('rejects unknown versions and incomplete response records', () => {
    expectRequestError(
      () => decodeAgentResponse(JSON.stringify({ schemaVersion: 2, response: {} })),
      'REQUEST_REPLAY_RECORD_INVALID'
    );
    expectRequestError(
      () => decodeAgentResponse(JSON.stringify({ schemaVersion: 1, response: {} })),
      'REQUEST_REPLAY_RECORD_INVALID'
    );
  });
});
