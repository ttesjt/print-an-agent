import { executeSessionNavigation } from '@print-an-agent/base-session';
import { expect, it, vi } from 'vitest';
import { createDeterministicAgentAPI } from '../../../../src/index.js';
import { storedRuntimeMemoryFixture as fixture } from '../../../support/management/session-context-memory-storage.js';
for (const storage of ['memory', 'sqlite'] as const) {
  for (const operation of ['fork', 'rewind'] as const) {
    it(`${storage}: rejects an existing ${operation} target before creating intent or Memory`, async () => {
      const f = await fixture(storage);
      const agent = createDeterministicAgentAPI({
        identity: { id: 'duplicate-target' },
        session: f.session,
        contextMemory: f.service,
        provider: {
          responses: [
            { status: 'success', text: 'one' },
            { status: 'success', text: 'two' },
          ],
        },
      });
      const first = await agent.run({ message: 'hello' });
      const ref = { agentId: agent.identity.id, sessionId: first.sessionId };
      const fork = vi.spyOn(f.memory.workflows.fork, 'run');
      const write = vi.spyOn(f.session, 'writeMemoryRecord');
      await expect(
        executeSessionNavigation({
          agentId: agent.identity.id,
          session: f.service.navigationPort(f.session),
          navigation: {
            sessionId: ref.sessionId,
            ...(operation === 'fork' ? { operation, sourceBranchId: 'main' } : { operation }),
            throughTurnId: first.requestId,
            newBranchId: 'main',
            expectedRevision: (await f.session.inspect(ref))!.navigation.revision,
          },
        })
      ).rejects.toMatchObject({ code: 'SESSION_BRANCH_ALREADY_EXISTS' });
      expect(fork).not.toHaveBeenCalled();
      expect(write).not.toHaveBeenCalled();
      expect(await f.session.listPendingMemoryRecords(ref)).toEqual([]);
      await f.service.recover(ref);
      expect(
        (await agent.run({ sessionId: first.sessionId, message: 'continue' })).message.text
      ).toBe('two');
    });
  }
}
