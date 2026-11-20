import {
  MemoryOutputSink,
  MemoryRequestJournalAdapter,
  MemorySessionAdapter,
} from '@print-an-agent/base-local-adapters';
import { describe, expect, it, vi } from 'vitest';
import { createDeterministicAgentAPI } from '../../../../src/index.js';

describe('request Session identity', () => {
  it('creates without an ID and opens the exact returned ID on the next request', async () => {
    const session = new MemorySessionAdapter();
    const api = createDeterministicAgentAPI({
      identity: { id: 'identity-agent' },
      session,
      provider: {
        responses: [
          { status: 'success', text: 'one' },
          { status: 'success', text: 'two' },
          { status: 'success', text: 'three' },
        ],
      },
    });
    const first = await api.run({ message: 'create' });
    const next = await api.run({ message: 'continue', sessionId: first.sessionId });
    const independent = await api.run({ message: 'create another' });
    expect(next.sessionId).toBe(first.sessionId);
    expect(independent.sessionId).not.toBe(first.sessionId);
    expect(
      (await session.inspect({ agentId: api.identity.id, sessionId: first.sessionId }))?.turns
    ).toHaveLength(2);
    expect(
      (await session.inspect({ agentId: api.identity.id, sessionId: independent.sessionId }))?.turns
    ).toHaveLength(1);
  });

  it('rejects unknown IDs before model execution or Journal claim without creating a Session', async () => {
    const session = new MemorySessionAdapter();
    const journal = new MemoryRequestJournalAdapter();
    const claim = vi.spyOn(journal, 'claim');
    const sink = new MemoryOutputSink();
    const api = createDeterministicAgentAPI({
      identity: { id: 'identity-agent' },
      session,
      requestJournal: journal,
      provider: { responses: [{ status: 'success', text: 'must not execute' }] },
    });
    await expect(
      api.run({
        message: 'open',
        sessionId: 'not-created',
        idempotencyKey: 'retry',
        outputSink: sink,
      })
    ).rejects.toMatchObject({ code: 'SESSION_NOT_FOUND' });
    expect(api.inspectDeterministicProvider().callCount).toBe(0);
    expect(claim).not.toHaveBeenCalled();
    expect((await session.listSessions({ agentId: api.identity.id })).records).toEqual([]);
    expect(sink.inspect().status).toBe('failed');
  });
});
