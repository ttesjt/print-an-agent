import { executeSessionNavigation } from '@print-an-agent/base-session';
import { expect, it, vi } from 'vitest';
import type { DeterministicProviderResponseFactory } from '../../../../src/index.js';
import { createDeterministicAgentAPI } from '../../../../src/index.js';
import {
  runtimeMemoryFixture as fixture,
  memoryToolPermissions as permissions,
} from '../../../support/management/runtime-context-memory.js';

it('loads a version-pinned full snapshot into the real Request Workflow and persists exact checkpoints', async () => {
  const f = fixture();
  try {
    const agent = createDeterministicAgentAPI({
      identity: { id: 'a' },
      session: f.session,
      contextMemory: f.service,
      provider: {
        responses: [
          (request) => ({ status: 'success', text: request.messages.map((m) => m.text).join('|') }),
          (request) => ({ status: 'success', text: request.messages.map((m) => m.text).join('|') }),
        ],
      },
    });
    const first = await agent.run({ message: 'hello' });
    expect(first.message.text).toContain('session-context-memory');
    const cp = await f.service.readCheckpoint(
      { agentId: agent.identity.id, sessionId: first.sessionId },
      first.requestId
    );
    expect(cp?.settled).toBe(true);
    if (cp === undefined) throw new Error('Missing checkpoint');
    await f.memory.workflows.apply.run({
      input: {
        memoryId: cp.final.memoryId,
        requestId: 'external-edit',
        expectedRevision: cp.final.revision,
        commands: [{ op: 'add', content: 'remembered' }],
      },
    });
    const second = await agent.run({ sessionId: first.sessionId, message: 'next' });
    expect(second.message.text).toContain('remembered');
    expect((await f.memory.workflows.inspectVersion.run({ input: cp.input }))?.items).toEqual([]);
  } finally {
    f.store.close();
  }
});

it('forks the exact historical checkpoint, replays navigation and keeps branches independent', async () => {
  const f = fixture(true);
  try {
    const agent = createDeterministicAgentAPI({
      identity: { id: 'brancher' },
      session: f.session,
      contextMemory: f.service,
      ...permissions(),
      provider: {
        responses: [
          {
            status: 'tool-call',
            name: 'apply_context_memory',
            callId: 'save',
            arguments: {
              expectedRevision: 1,
              commands: [{ op: 'add', itemId: '', content: 'historical' }],
            },
          },
          { status: 'success', text: 'ok' },
          { status: 'success', text: 'later' },
          (request) => ({ status: 'success', text: request.messages.map((m) => m.text).join('|') }),
        ],
      },
    });
    const first = await agent.run({ message: 'save' });
    const ref = { agentId: agent.identity.id, sessionId: first.sessionId };
    const cp = await f.service.readCheckpoint(ref, first.requestId);
    if (cp === undefined) throw new Error('Missing checkpoint');
    await f.memory.workflows.apply.run({
      input: {
        memoryId: cp.final.memoryId,
        requestId: 'later',
        expectedRevision: 2,
        commands: [
          {
            op: 'replace',
            itemId: (await f.memory.workflows.inspect.run({
              input: { memoryId: cp.final.memoryId },
            }))!.items[0]!.id,
            content: 'newer',
          },
        ],
      },
    });
    await agent.run({ sessionId: first.sessionId, message: 'later' });
    const navigation = f.service.navigationPort(f.session);
    const forkRequest = {
      agentId: agent.identity.id,
      session: navigation,
      navigation: {
        sessionId: first.sessionId,
        operation: 'fork' as const,
        sourceBranchId: 'main',
        throughTurnId: first.requestId,
        expectedRevision: (await f.session.inspect(ref))!.navigation.revision,
      },
    };
    const fork = await executeSessionNavigation(forkRequest);
    expect(await executeSessionNavigation(forkRequest)).toEqual(fork);
    if (fork.status !== 'forked') throw new Error('Expected fork');
    await executeSessionNavigation({
      agentId: agent.identity.id,
      session: navigation,
      navigation: {
        sessionId: first.sessionId,
        operation: 'select',
        branchId: fork.affectedBranchId,
        expectedRevision: fork.revision,
      },
    });
    const next = await agent.run({ sessionId: first.sessionId, message: 'recall' });
    const branched = await f.service.readCheckpoint(ref, next.requestId);
    expect(branched?.input.revision).toBe(1);
    expect(branched?.input.memoryId).not.toBe(cp.final.memoryId);
    const memory = await f.memory.workflows.inspectVersion.run({ input: branched!.input });
    expect(memory?.items.map((i) => i.content)).toEqual(['historical']);
    expect(
      (await f.memory.workflows.inspect.run({ input: { memoryId: cp.final.memoryId } }))?.items.map(
        (i) => i.content
      )
    ).toEqual(['newer']);
  } finally {
    f.store.close();
  }
});

it('recovers Memory fork committed before Session publication without model or head fallback', async () => {
  const f = fixture();
  try {
    const agent = createDeterministicAgentAPI({
      identity: { id: 'branch-recovery' },
      session: f.session,
      contextMemory: f.service,
      provider: { responses: [{ status: 'success', text: 'ok' }] },
    });
    const first = await agent.run({ message: 'hello' });
    const ref = { agentId: agent.identity.id, sessionId: first.sessionId };
    const publish = vi
      .spyOn(f.session, 'publishMemoryNavigation')
      .mockRejectedValueOnce(new Error('publication unavailable'));
    await expect(
      executeSessionNavigation({
        agentId: agent.identity.id,
        session: f.service.navigationPort(f.session),
        navigation: {
          sessionId: first.sessionId,
          operation: 'rewind',
          throughTurnId: first.requestId,
          expectedRevision: (await f.session.inspect(ref))!.navigation.revision,
        },
      })
    ).rejects.toMatchObject({ commit: { status: 'committed' } });
    expect((await f.session.inspect(ref))?.navigation.branches).toHaveLength(1);
    expect(await f.session.listPendingMemoryRecords(ref)).toHaveLength(1);
    await f.service.recover(ref);
    expect(publish).toHaveBeenCalledTimes(2);
    expect((await f.session.inspect(ref))?.navigation.branches).toHaveLength(2);
    expect(await f.session.listPendingMemoryRecords(ref)).toHaveLength(0);
  } finally {
    f.store.close();
  }
});

it('commits each Memory tool atomically and exposes the result to the next Turn', async () => {
  const f = fixture(true);
  try {
    const agent = createDeterministicAgentAPI({
      identity: { id: 'writer' },
      session: f.session,
      contextMemory: f.service,
      ...permissions(),
      provider: {
        responses: [
          {
            status: 'tool-call',
            name: 'apply_context_memory',
            callId: 'write',
            arguments: {
              expectedRevision: 1,
              commands: [{ op: 'add', itemId: '', content: 'confirmed decision' }],
            },
          },
          { status: 'success', text: 'saved' },
          (request) => ({ status: 'success', text: request.messages.map((m) => m.text).join('|') }),
        ],
      },
    });
    const first = await agent.run({ message: 'remember the decision' });
    const cp = await f.service.readCheckpoint(
      { agentId: agent.identity.id, sessionId: first.sessionId },
      first.requestId
    );
    expect(cp?.final.revision).toBe(2);
    expect(cp?.input.revision).toBe(1);
    const next = await agent.run({ sessionId: first.sessionId, message: 'recall' });
    expect(next.message.text).toContain('confirmed decision');
    expect((await f.memory.workflows.inspectVersion.run({ input: cp!.input }))?.items).toEqual([]);
  } finally {
    f.store.close();
  }
});

it('recovers a committed write after checkpoint persistence fails without another model call', async () => {
  const f = fixture(true);
  let fail = true;
  const write = f.session.writeMemoryRecord.bind(f.session);
  vi.spyOn(f.session, 'writeMemoryRecord').mockImplementation((input) => {
    if (fail && input.kind === 'turn' && input.value.includes('"revision":2'))
      return Promise.reject(new Error('injected checkpoint failure'));
    return write(input);
  });
  try {
    const agent = createDeterministicAgentAPI({
      identity: { id: 'writer' },
      session: f.session,
      contextMemory: f.service,
      ...permissions(),
      provider: {
        responses: [
          {
            status: 'tool-call',
            name: 'apply_context_memory',
            callId: 'write',
            arguments: {
              expectedRevision: 1,
              commands: [{ op: 'add', itemId: '', content: 'durable' }],
            },
          },
          { status: 'success', text: 'done' },
        ],
      },
    });
    await expect(
      agent.run({
        message: 'save',
        outputSink: {
          open: async () => {},
          write: async () => {},
          close: async () => {},
          fail: async () => {},
        },
      })
    ).rejects.toBeDefined();
    const list = await f.session.listSessions({ agentId: agent.identity.id });
    const item = list.records[0];
    if (item === undefined) throw new Error('Missing Session');
    const ref = { agentId: agent.identity.id, sessionId: item.sessionId };
    const pending = await f.session.listPendingMemoryRecords(ref);
    expect(pending.some((p) => p.kind === 'mutation')).toBe(true);
    const before = await f.session.inspectSession(ref);
    if (before === undefined) throw new Error('Missing fence');
    await expect(
      f.session.recoverSessionExecutions({
        ...ref,
        expectedExecutionRevision: before.execution.revision,
      })
    ).rejects.toMatchObject({ code: 'SESSION_RECOVERY_FAILED' });
    fail = false;
    const calls = agent.inspectDeterministicProvider().callCount;
    await f.service.recover(ref);
    expect(await f.session.listPendingMemoryRecords(ref)).toEqual([]);
    expect(agent.inspectDeterministicProvider().callCount).toBe(calls);
    const turn = pending.find((p) => p.kind === 'turn');
    if (turn === undefined) throw new Error('Missing Turn checkpoint');
    const cp = await f.service.readCheckpoint(ref, turn.id);
    expect(cp?.final.revision).toBe(2);
    const state = await f.session.inspectSession(ref);
    if (state === undefined) throw new Error('Missing fence');
    await f.session.recoverSessionExecutions({
      ...ref,
      expectedExecutionRevision: state.execution.revision,
    });
  } finally {
    f.store.close();
    vi.restoreAllMocks();
  }
});

it('keeps concurrent Session bindings independent on a reused raw runtime', async () => {
  const f = fixture();
  try {
    const agent = createDeterministicAgentAPI({
      identity: { id: 'a' },
      session: f.session,
      contextMemory: f.service,
      provider: {
        responses: [
          { status: 'success', text: 'ok' },
          { status: 'success', text: 'ok' },
        ],
      },
    });
    const [a, b] = await Promise.all([agent.run({ message: 'A' }), agent.run({ message: 'B' })]);
    const ca = await f.service.readCheckpoint(
      { agentId: agent.identity.id, sessionId: a.sessionId },
      a.requestId
    );
    const cb = await f.service.readCheckpoint(
      { agentId: agent.identity.id, sessionId: b.sessionId },
      b.requestId
    );
    expect(ca?.input.memoryId).not.toBe(cb?.input.memoryId);
  } finally {
    f.store.close();
  }
});

it('binds concurrent tool writes to each admitted Session on one reused raw Agent', async () => {
  const f = fixture(true);
  try {
    const response: DeterministicProviderResponseFactory = (request) =>
      request.toolResults.length !== 0
        ? { status: 'success', text: 'saved' }
        : {
            status: 'tool-call',
            name: 'apply_context_memory',
            callId: 'same-call-id',
            arguments: {
              expectedRevision: 1,
              commands: [
                {
                  op: 'add',
                  itemId: '',
                  content: request.messages.findLast((m) => m.role === 'user')?.text ?? 'missing',
                },
              ],
            },
          };
    const agent = createDeterministicAgentAPI({
      identity: { id: 'concurrent-writer' },
      session: f.session,
      contextMemory: f.service,
      ...permissions(),
      provider: { responses: [response, response, response, response] },
    });
    const [a, b] = await Promise.all([
      agent.run({ message: 'A memory' }),
      agent.run({ message: 'B memory' }),
    ]);
    const inspect = async (result: typeof a) => {
      const ref = { agentId: agent.identity.id, sessionId: result.sessionId };
      const cp = await f.service.readCheckpoint(ref, result.requestId);
      if (cp === undefined) throw new Error('Missing checkpoint');
      return f.memory.workflows.inspectVersion.run({ input: cp.final });
    };
    expect((await inspect(a))?.items.map((i) => i.content)).toEqual(['A memory']);
    expect((await inspect(b))?.items.map((i) => i.content)).toEqual(['B memory']);
  } finally {
    f.store.close();
  }
});
