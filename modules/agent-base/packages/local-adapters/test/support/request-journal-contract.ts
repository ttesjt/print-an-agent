import { defineAgentIdentity } from '@ta-agent/base-identity';
import {
  defineAssistantModelMessage,
  defineEngineDefinedModelExecutionProvenance,
  defineProviderModelExecutionProvenance,
  defineProviderModelReference,
  type ModelExecutionProvenance,
} from '@ta-agent/base-model';
import { DEFAULT_SESSION_BRANCH_ID, parseSessionId } from '@ta-agent/base-session';
import { describe, expect, it } from 'vitest';
import {
  AgentRequestError,
  createRequestFingerprint,
  parseRequestIdempotencyKey,
  type AgentResponse,
  type InspectableRequestJournalPort,
  type RequestJournalReference,
} from '@ta-agent/base-request';

const model = defineProviderModelReference({ provider: 'faux', model: 'faux-model' });

export interface RequestJournalContractHarness {
  readonly journal: InspectableRequestJournalPort;
  readonly dispose?: () => void;
}

export function journalReference(
  agentId = 'journal-agent',
  sessionId = 'conversation',
  idempotencyKey = 'request-key'
): RequestJournalReference {
  return Object.freeze({
    agentId: defineAgentIdentity({ id: agentId }).id,
    sessionId: parseSessionId(sessionId),
    idempotencyKey: parseRequestIdempotencyKey(idempotencyKey),
  });
}

export function journalResponse(
  requestId: string,
  sessionId = 'conversation',
  text = 'completed',
  provenance: ModelExecutionProvenance = defineProviderModelExecutionProvenance(model)
): AgentResponse {
  return Object.freeze({
    requestId,
    sessionId: parseSessionId(sessionId),
    branchId: DEFAULT_SESSION_BRANCH_ID,
    message: defineAssistantModelMessage({
      role: 'assistant',
      text,
      provenance,
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

export function engineDefinedJournalResponse(requestId: string): AgentResponse {
  return journalResponse(
    requestId,
    'conversation',
    'engine completed',
    defineEngineDefinedModelExecutionProvenance({
      type: 'test.runtime-target',
      evidence: {
        artifact: { id: 'artifact-1', revision: 3 },
        route: ['embedded', 'generation-7'],
      },
    })
  );
}

async function withHarness<T>(
  createHarness: () => RequestJournalContractHarness,
  action: (journal: InspectableRequestJournalPort) => Promise<T>
): Promise<T> {
  const harness = createHarness();
  try {
    return await action(harness.journal);
  } finally {
    harness.dispose?.();
  }
}

export function defineRequestJournalContract(
  adapterName: string,
  createHarness: () => RequestJournalContractHarness
): void {
  describe(`${adapterName} RequestJournalPort contract`, () => {
    it('claims once and returns the exact active authority', () =>
      withHarness(createHarness, async (journal) => {
        const reference = journalReference();
        const fingerprint = createRequestFingerprint({ message: 'hello' });
        const first = await journal.claim({ ...reference, fingerprint, requestId: 'request-1' });
        const duplicate = await journal.claim({
          ...reference,
          fingerprint,
          requestId: 'request-2',
        });

        expect(first).toMatchObject({ status: 'claimed', entry: { requestId: 'request-1' } });
        expect(duplicate).toMatchObject({
          status: 'existing',
          entry: { status: 'active', requestId: 'request-1' },
        });
      }));

    it('completes once and keeps the terminal response authoritative', () =>
      withHarness(createHarness, async (journal) => {
        const reference = journalReference();
        await journal.claim({
          ...reference,
          fingerprint: createRequestFingerprint({ message: 'hello' }),
          requestId: 'request-1',
        });
        const completed = await journal.complete({
          ...reference,
          requestId: 'request-1',
          response: journalResponse('request-1'),
        });

        expect(completed).toMatchObject({
          status: 'completed',
          response: { requestId: 'request-1' },
        });
        expect(
          await journal.fail({
            ...reference,
            requestId: 'request-1',
            failure: { code: 'LATE_FAILURE', message: 'late' },
          })
        ).toEqual(completed);
        await expect(
          journal.complete({
            ...reference,
            requestId: 'request-1',
            response: journalResponse('request-1'),
          })
        ).rejects.toEqual(
          expect.objectContaining<Partial<AgentRequestError>>({
            code: 'REQUEST_REPLAY_STATE_INVALID',
          })
        );
      }));

    it('round-trips deeply immutable engine-defined provenance through replay authority', () =>
      withHarness(createHarness, async (journal) => {
        const reference = journalReference(
          'engine-evidence-agent',
          'conversation',
          'engine-evidence-key'
        );
        await journal.claim({
          ...reference,
          fingerprint: createRequestFingerprint({ message: 'invoke custom engine' }),
          requestId: 'engine-request',
        });
        const expected = engineDefinedJournalResponse('engine-request');
        await journal.complete({ ...reference, requestId: 'engine-request', response: expected });

        const inspected = await journal.inspect(reference);
        expect(inspected).toMatchObject({ status: 'completed', response: expected });
        const provenance =
          inspected?.status === 'completed' ? inspected.response.message.provenance : undefined;
        expect(provenance?.kind).toBe('engine-defined');
        if (provenance?.kind === 'engine-defined') {
          expect(Object.isFrozen(provenance.evidence)).toBe(true);
          expect(Object.isFrozen(provenance.evidence.artifact)).toBe(true);
          expect(Object.isFrozen(provenance.evidence.route)).toBe(true);
        }
      }));

    it('fails once and rejects a later completion', () =>
      withHarness(createHarness, async (journal) => {
        const reference = journalReference();
        await journal.claim({
          ...reference,
          fingerprint: createRequestFingerprint({ message: 'hello' }),
          requestId: 'request-1',
        });
        const failed = await journal.fail({
          ...reference,
          requestId: 'request-1',
          failure: { code: 'MODEL_FAILED', message: 'provider unavailable' },
        });

        expect(failed).toMatchObject({ status: 'failed', failure: { code: 'MODEL_FAILED' } });
        expect(
          await journal.fail({
            ...reference,
            requestId: 'request-1',
            failure: { code: 'OTHER', message: 'ignored' },
          })
        ).toEqual(failed);
        await expect(
          journal.complete({
            ...reference,
            requestId: 'request-1',
            response: journalResponse('request-1'),
          })
        ).rejects.toEqual(
          expect.objectContaining<Partial<AgentRequestError>>({
            code: 'REQUEST_REPLAY_STATE_INVALID',
          })
        );
      }));

    it('rejects fingerprint conflicts and non-owning terminal writes', () =>
      withHarness(createHarness, async (journal) => {
        const reference = journalReference();
        await journal.claim({
          ...reference,
          fingerprint: createRequestFingerprint({ message: 'hello' }),
          requestId: 'request-1',
        });

        await expect(
          journal.claim({
            ...reference,
            fingerprint: createRequestFingerprint({ message: 'different' }),
            requestId: 'request-2',
          })
        ).rejects.toEqual(
          expect.objectContaining<Partial<AgentRequestError>>({ code: 'REQUEST_REPLAY_CONFLICT' })
        );
        await expect(
          journal.fail({
            ...reference,
            requestId: 'request-2',
            failure: { code: 'NOT_OWNER', message: 'not owner' },
          })
        ).rejects.toEqual(
          expect.objectContaining<Partial<AgentRequestError>>({
            code: 'REQUEST_REPLAY_STATE_INVALID',
          })
        );
      }));

    it('isolates Agent and Session namespaces and returns immutable records', () =>
      withHarness(createHarness, async (journal) => {
        const first = journalReference('first-agent', 'shared', 'same-key');
        const second = journalReference('second-agent', 'shared', 'same-key');
        const third = journalReference('first-agent', 'other-session', 'same-key');
        const fingerprint = createRequestFingerprint({ message: 'hello' });
        await journal.claim({ ...first, fingerprint, requestId: 'first-request' });
        await journal.claim({ ...second, fingerprint, requestId: 'second-request' });
        await journal.claim({ ...third, fingerprint, requestId: 'third-request' });

        const inspected = await journal.inspect(first);
        expect(inspected?.requestId).toBe('first-request');
        expect((await journal.inspect(second))?.requestId).toBe('second-request');
        expect((await journal.inspect(third))?.requestId).toBe('third-request');
        expect(Object.isFrozen(inspected)).toBe(true);
      }));
  });
}
