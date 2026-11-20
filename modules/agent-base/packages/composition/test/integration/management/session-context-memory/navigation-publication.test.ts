import { AgentSessionError, executeSessionNavigation } from '@print-an-agent/base-session';
import { expect, it, vi } from 'vitest';
import { createDeterministicAgentAPI } from '../../../../src/index.js';
import { storedRuntimeMemoryFixture as fixture } from '../../../support/management/session-context-memory-storage.js';
for (const storage of ['memory', 'sqlite'] as const) {
  it(`${storage}: durably rejects impossible publication, retaining its already committed fork`, async () => {
    const f = await fixture(storage);
    const agent = createDeterministicAgentAPI({
      identity: { id: 'rejected-publication' },
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
    const publish = vi
      .spyOn(f.session, 'publishMemoryNavigation')
      .mockRejectedValueOnce(
        new AgentSessionError(
          'SESSION_NAVIGATION_CONFLICT',
          'Authority rejected the stale publication.'
        )
      );
    const request = {
      agentId: agent.identity.id,
      session: f.service.navigationPort(f.session),
      navigation: {
        sessionId: ref.sessionId,
        operation: 'rewind' as const,
        throughTurnId: first.requestId,
        expectedRevision: (await f.session.inspect(ref))!.navigation.revision,
      },
    };
    await expect(executeSessionNavigation(request)).rejects.toMatchObject({
      code: 'SESSION_NAVIGATION_CONFLICT',
      commit: { status: 'committed', receipt: { operation: 'fork' } },
    });
    expect(await f.session.listPendingMemoryRecords(ref)).toEqual([]);
    await f.service.recover(ref);
    await expect(executeSessionNavigation(request)).rejects.toMatchObject({
      code: 'SESSION_NAVIGATION_CONFLICT',
      commit: { status: 'committed' },
    });
    expect(fork).toHaveBeenCalledOnce();
    expect(publish).toHaveBeenCalledOnce();
    expect((await f.session.inspect(ref))?.navigation.branches).toHaveLength(1);
    expect(
      (await agent.run({ sessionId: first.sessionId, message: 'continue' })).message.text
    ).toBe('two');
  });

  it(`${storage}: recovery terminates a definite rejection after a transient publication failure`, async () => {
    const f = await fixture(storage);
    const agent = createDeterministicAgentAPI({
      identity: { id: 'recover-rejection' },
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
    const publish = vi
      .spyOn(f.session, 'publishMemoryNavigation')
      .mockRejectedValueOnce(new Error('Storage temporarily unavailable.'))
      .mockRejectedValueOnce(
        new AgentSessionError('SESSION_BRANCH_ALREADY_EXISTS', 'Target now exists.')
      );
    const fork = vi.spyOn(f.memory.workflows.fork, 'run');
    const request = {
      agentId: agent.identity.id,
      session: f.service.navigationPort(f.session),
      navigation: {
        sessionId: ref.sessionId,
        operation: 'rewind' as const,
        throughTurnId: first.requestId,
        expectedRevision: (await f.session.inspect(ref))!.navigation.revision,
      },
    };
    await expect(executeSessionNavigation(request)).rejects.toMatchObject({
      commit: { status: 'committed' },
    });
    expect(await f.session.listPendingMemoryRecords(ref)).toHaveLength(1);
    await f.service.recover(ref);
    expect(publish).toHaveBeenCalledTimes(2);
    expect(fork).toHaveBeenCalledOnce();
    expect(await f.session.listPendingMemoryRecords(ref)).toEqual([]);
    await expect(executeSessionNavigation(request)).rejects.toMatchObject({
      code: 'SESSION_BRANCH_ALREADY_EXISTS',
      commit: { status: 'committed' },
    });
    expect(
      (await agent.run({ sessionId: first.sessionId, message: 'continue' })).message.text
    ).toBe('two');
  });

  it(`${storage}: does not replace an already published navigation with a later typed rejection`, async () => {
    const f = await fixture(storage);
    const agent = createDeterministicAgentAPI({
      identity: { id: 'published' },
      session: f.session,
      contextMemory: f.service,
      provider: { responses: [{ status: 'success', text: 'ready' }] },
    });
    const first = await agent.run({ message: 'hello' });
    const ref = { agentId: agent.identity.id, sessionId: first.sessionId };
    const publish = f.session.publishMemoryNavigation.bind(f.session);
    vi.spyOn(f.session, 'publishMemoryNavigation').mockImplementationOnce(async (input) => {
      await publish(input);
      throw new AgentSessionError('SESSION_NAVIGATION_CONFLICT', 'Late failure after publication.');
    });
    const fork = vi.spyOn(f.memory.workflows.fork, 'run');
    const request = {
      agentId: agent.identity.id,
      session: f.service.navigationPort(f.session),
      navigation: {
        sessionId: ref.sessionId,
        operation: 'rewind' as const,
        throughTurnId: first.requestId,
        expectedRevision: (await f.session.inspect(ref))!.navigation.revision,
      },
    };
    const result = await executeSessionNavigation(request);
    expect(result.status).toBe('rewound');
    expect(await executeSessionNavigation(request)).toEqual(result);
    expect(fork).toHaveBeenCalledOnce();
    expect((await f.session.inspect(ref))?.navigation.branches).toHaveLength(2);
    expect(await f.session.listPendingMemoryRecords(ref)).toEqual([]);
  });
}
