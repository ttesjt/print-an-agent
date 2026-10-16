import {
  defineAssistantModelMessage,
  defineEngineDefinedModelExecutionProvenance,
} from '@ta-agent/model-invocation-core';
import { DEFAULT_SESSION_BRANCH_ID, parseSessionId } from '@ta-agent/base-session';
import { describe, expect, it } from 'vitest';
import {
  AgentRequestError,
  createRequestFingerprint,
  decodeAgentResponse,
  encodeAgentResponse,
  parseRequestFingerprint,
  parseRequestIdempotencyKey,
  type AgentResponse,
} from '../../src/index.js';

function response(requestId: string): AgentResponse {
  return Object.freeze({
    requestId,
    sessionId: parseSessionId('conversation'),
    branchId: DEFAULT_SESSION_BRANCH_ID,
    message: defineAssistantModelMessage({
      role: 'assistant',
      text: 'completed',
      provenance: defineEngineDefinedModelExecutionProvenance({
        type: 'example.execution',
        evidence: {
          artifact: { id: 'artifact-1', revision: 3 },
          digest: 'sha256:abc',
        },
      }),
      stopReason: 'stop',
      usage: {
        inputTokens: 1,
        outputTokens: 1,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 2,
      },
      timestamp: 2,
    }),
    toolRun: Object.freeze({
      status: 'closed',
      effectiveTools: Object.freeze([]),
      records: Object.freeze([]),
      totalResultCharacters: 0,
    }),
  });
}

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

  it('round-trips an immutable versioned response wire value', () => {
    const original = response('request-1');
    const decoded = decodeAgentResponse(encodeAgentResponse(original));

    expect(decoded).toEqual(original);
    expect(Object.isFrozen(decoded)).toBe(true);
    expect(Object.isFrozen(decoded.message.provenance)).toBe(true);
    if (decoded.message.provenance.kind === 'engine-defined') {
      expect(Object.isFrozen(decoded.message.provenance.evidence)).toBe(true);
      expect(Object.isFrozen(decoded.message.provenance.evidence.artifact)).toBe(true);
    }
    expect(Object.isFrozen(decoded.message.usage)).toBe(true);
    expect(Object.isFrozen(decoded.toolRun.records)).toBe(true);
  });

  it('rejects legacy envelopes and assistant records instead of carrying compatibility paths', () => {
    const original = response('request');
    const legacyResponse = {
      requestId: original.requestId,
      sessionId: original.sessionId,
      message: original.message,
      toolRun: original.toolRun,
    };

    expectRequestError(
      () => decodeAgentResponse(JSON.stringify({ schemaVersion: 1, response: legacyResponse })),
      'REQUEST_REPLAY_RECORD_INVALID'
    );

    const legacyAssistant = {
      ...original.message,
      provenance: undefined,
      provider: 'faux',
      model: 'faux-model',
    };
    expectRequestError(
      () =>
        decodeAgentResponse(
          JSON.stringify({
            schemaVersion: 1,
            response: { ...original, message: legacyAssistant },
          })
        ),
      'REQUEST_REPLAY_RECORD_INVALID'
    );
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
