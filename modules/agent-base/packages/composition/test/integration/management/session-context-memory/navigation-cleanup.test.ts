import { AgentSessionError, executeSessionNavigation } from '@print-an-agent/base-session';
import { ContextMemoryError } from '@print-an-agent/context-memory';
import { expect, it, vi } from 'vitest';
import { createDeterministicAgentAPI } from '../../../../src/index.js';
import { storedRuntimeMemoryFixture as fixture } from '../../../support/management/session-context-memory-storage.js';
for (const storage of ['memory', 'sqlite'] as const) {
  it(`${storage}: a navigation rejection does not hide a simultaneous cleanup failure`, async () => {
    const f = await fixture(storage);
    const agent = createDeterministicAgentAPI({
      identity: { id: 'navigation-cleanup' },
      session: f.session,
      contextMemory: f.service,
      provider: { responses: [{ status: 'success', text: 'ready' }] },
    });
    const first = await agent.run({ message: 'hello' });
    const ref = { agentId: agent.identity.id, sessionId: first.sessionId };
    vi.spyOn(f.session, 'publishMemoryNavigation').mockRejectedValueOnce(
      new AggregateError([
        new AgentSessionError('SESSION_NAVIGATION_CONFLICT', 'Publication rejected.'),
        new ContextMemoryError('CLEANUP_FAILED', 'Cleanup is unconfirmed.'),
      ])
    );
    await expect(
      executeSessionNavigation({
        agentId: agent.identity.id,
        session: f.service.navigationPort(f.session),
        navigation: {
          sessionId: ref.sessionId,
          operation: 'rewind',
          throughTurnId: first.requestId,
          expectedRevision: (await f.session.inspect(ref))!.navigation.revision,
        },
      })
    ).rejects.toMatchObject({
      code: 'SESSION_MEMORY_CLEANUP_FAILED',
      commit: { status: 'committed' },
    });
    expect(await f.session.listPendingMemoryRecords(ref)).toHaveLength(1);
    await expect(f.service.recover(ref)).rejects.toMatchObject({
      code: 'SESSION_MEMORY_CLEANUP_FAILED',
      commit: { status: 'committed' },
    });
    expect(await f.session.listPendingMemoryRecords(ref)).toHaveLength(1);
  });
}
