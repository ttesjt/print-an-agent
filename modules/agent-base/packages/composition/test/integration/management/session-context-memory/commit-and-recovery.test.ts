import { parseAgentId } from '@print-an-agent/base-identity-config/identity';
import { createMemorySessionPersistence } from '@print-an-agent/base-local-adapters';
import {
  executeSessionNavigation,
  supportsSessionMemoryNavigation,
} from '@print-an-agent/base-session';
import {
  ContextMemoryError,
  createMemoryApplyDefinition,
  createMemoryGetReceiptDefinition,
} from '@print-an-agent/context-memory';
import { expect, it, vi } from 'vitest';
import {
  createDeterministicAgentAPI,
  createSessionContextMemory,
  recoverSessionWithContextMemory,
} from '../../../../src/index.js';
import {
  memoryToolPermissions,
  runtimeMemoryFixture,
} from '../../../support/management/runtime-context-memory.js';

it('retains committed evidence and cleanup fencing independently of late cancellation', async () => {
  const abort = new AbortController();
  const f = runtimeMemoryFixture(true, {
    apply: createMemoryApplyDefinition({
      executeStep: async (execution) => {
        await execution.step(execution.context);
        if (execution.stepName === 'executeOperation') abort.abort();
      },
      lifecycle: {
        onFinally: () => {
          throw new ContextMemoryError('CLEANUP_FAILED', 'injected cleanup failure');
        },
      },
    }),
  });
  const apply = vi.spyOn(f.memory.workflows.apply, 'run');
  try {
    const agent = createDeterministicAgentAPI({
      identity: { id: 'cleanup' },
      session: f.session,
      contextMemory: f.service,
      provider: { responses: [{ status: 'success', text: 'ready' }] },
    });
    const result = await agent.run({ message: 'initialize' });
    const ref = { agentId: agent.identity.id, sessionId: result.sessionId };
    const branch = await f.session.resolve(ref);
    await expect(
      f.service.apply(
        branch,
        { requestId: 'write', expectedRevision: 1, commands: [{ op: 'add', content: 'durable' }] },
        abort.signal
      )
    ).rejects.toMatchObject({
      code: 'SESSION_MEMORY_CLEANUP_FAILED',
      commit: { status: 'committed', receipt: { revision: 2 } },
    });
    await expect(f.service.recover(ref)).rejects.toMatchObject({
      code: 'SESSION_MEMORY_CLEANUP_FAILED',
      commit: { status: 'committed' },
    });
    await expect(
      f.service.apply(
        branch,
        { requestId: 'write', expectedRevision: 1, commands: [{ op: 'add', content: 'durable' }] },
        abort.signal
      )
    ).rejects.toMatchObject({
      code: 'SESSION_MEMORY_CLEANUP_FAILED',
      commit: { status: 'committed', receipt: { revision: 2 } },
    });
    expect(apply).toHaveBeenCalledOnce();
    await expect(f.session.retireSession({ ...ref, expectedRevision: 0 })).rejects.toMatchObject({
      code: 'SESSION_BUSY',
    });
    expect((await f.service.inspect(branch))?.items.map((i) => i.content)).toEqual(['durable']);
    const pending = (await f.session.listPendingMemoryRecords(ref))[0];
    if (pending === undefined) throw new Error('Missing cleanup intent');
    // A trusted resource owner may confirm actual cleanup; receipt recovery still performs no write.
    await f.service.acknowledgeCleanup(ref, pending.kind, pending.id, pending.revision);
    await f.service.recover(ref);
    expect(await f.session.listPendingMemoryRecords(ref)).toEqual([]);
  } finally {
    f.store.close();
  }
});

it('admits idle management writes, rejects active writes and leaves previous checkpoints immutable', async () => {
  const f = runtimeMemoryFixture(true);
  try {
    const agent = createDeterministicAgentAPI({
      identity: { id: 'managed' },
      session: f.session,
      contextMemory: f.service,
      provider: {
        responses: [
          { status: 'success', text: 'one' },
          { status: 'success', text: 'two' },
        ],
      },
    });
    const first = await agent.run({ message: 'one' });
    const ref = { agentId: agent.identity.id, sessionId: first.sessionId };
    const cp = await f.service.readCheckpoint(ref, first.requestId);
    const branch = await f.session.resolve(ref);
    await expect(
      executeSessionNavigation({
        agentId: agent.identity.id,
        session: f.session,
        navigation: {
          sessionId: first.sessionId,
          operation: 'select',
          branchId: branch.branchId,
          expectedRevision: branch.navigationRevision,
        },
      })
    ).rejects.toMatchObject({ code: 'SESSION_MEMORY_NOT_CONFIGURED' });
    const execution = await f.session.acquireSessionExecution(ref);
    const input = {
      requestId: 'management-edit',
      expectedRevision: 1,
      commands: [{ op: 'add' as const, content: 'external' }],
    };
    await expect(f.service.apply(branch, input)).rejects.toMatchObject({ code: 'SESSION_BUSY' });
    expect(await f.session.listPendingMemoryRecords(ref)).toEqual([]);
    await f.session.releaseSessionExecution(execution);
    await f.service.apply(branch, input);
    expect(await f.service.readCheckpoint(ref, first.requestId)).toEqual(cp);
    const next = await agent.run({ sessionId: first.sessionId, message: 'two' });
    expect((await f.service.readCheckpoint(ref, next.requestId))?.input.revision).toBe(2);
    await f.service.apply(branch, input); // exact request replay, not another revision
    const aborted = new AbortController();
    aborted.abort();
    expect(
      JSON.parse(await f.service.apply(branch, input, aborted.signal)) as unknown
    ).toMatchObject({ receipt: { revision: 2 } });
    expect((await f.service.inspect(branch))?.revision).toBe(2);
  } finally {
    f.store.close();
  }
});

it('keeps recovered receipt evidence when receipt-query post-processing itself fails', async () => {
  let cleanupFailure = true;
  const f = runtimeMemoryFixture(true, {
    getReceipt: createMemoryGetReceiptDefinition({
      lifecycle: {
        onFinally: () => {
          if (cleanupFailure)
            throw new ContextMemoryError('CLEANUP_FAILED', 'receipt-query cleanup');
        },
      },
    }),
  });
  const write = f.session.writeMemoryRecord.bind(f.session);
  let failCheckpoint = true;
  vi.spyOn(f.session, 'writeMemoryRecord').mockImplementation((input) =>
    failCheckpoint && input.kind === 'turn' && input.value.includes('"revision":2')
      ? Promise.reject(new Error('checkpoint unavailable'))
      : write(input)
  );
  try {
    const agent = createDeterministicAgentAPI({
      identity: { id: 'receipt-recovery' },
      session: f.session,
      contextMemory: f.service,
      ...memoryToolPermissions(),
      provider: {
        responses: [
          {
            status: 'tool-call',
            name: 'apply_context_memory',
            callId: 'save',
            arguments: {
              expectedRevision: 1,
              commands: [{ op: 'add', itemId: '', content: 'durable' }],
            },
          },
          { status: 'success', text: 'saved' },
        ],
      },
    });
    await expect(agent.run({ message: 'save' })).rejects.toBeDefined();
    const listed = await f.session.listSessions({ agentId: agent.identity.id });
    const row = listed.records[0];
    if (row === undefined) throw new Error('Missing Session');
    const ref = { agentId: agent.identity.id, sessionId: row.sessionId };
    const state = await f.session.inspectSession(ref);
    if (state === undefined) throw new Error('Missing lifecycle');
    await expect(
      f.session.recoverSessionExecutions({
        ...ref,
        expectedExecutionRevision: state.execution.revision,
      })
    ).rejects.toBeDefined();
    failCheckpoint = false;
    await expect(f.service.recover(ref)).rejects.toMatchObject({
      code: 'SESSION_MEMORY_CLEANUP_FAILED',
      commit: { status: 'committed', receipt: { revision: 2 } },
    });
    const pending = (await f.session.listPendingMemoryRecords(ref)).find(
      (record) => record.kind === 'mutation'
    );
    if (pending === undefined) throw new Error('Missing pending cleanup');
    cleanupFailure = false;
    await f.service.acknowledgeCleanup(ref, pending.kind, pending.id, pending.revision);
    await f.service.recover(ref);
    expect(await f.session.listPendingMemoryRecords(ref)).toEqual([]);
  } finally {
    f.store.close();
  }
});

it('recovers a lost Session write response without repeating the Memory tool or model', async () => {
  const f = runtimeMemoryFixture(true);
  const original = f.session.writeMemoryRecord.bind(f.session);
  let dropped = false;
  vi.spyOn(f.session, 'writeMemoryRecord').mockImplementation(async (input) => {
    const result = await original(input);
    if (!dropped && input.kind === 'turn' && input.value.includes('"revision":2')) {
      dropped = true;
      throw new Error('response lost after Session commit');
    }
    return result;
  });
  const apply = vi.spyOn(f.memory.workflows.apply, 'run');
  try {
    const agent = createDeterministicAgentAPI({
      identity: { id: 'response-loss' },
      session: f.session,
      contextMemory: f.service,
      ...memoryToolPermissions(),
      provider: {
        responses: [
          {
            status: 'tool-call',
            name: 'apply_context_memory',
            callId: 'save',
            arguments: {
              expectedRevision: 1,
              commands: [{ op: 'add', itemId: '', content: 'one write' }],
            },
          },
          { status: 'success', text: 'saved' },
        ],
      },
    });
    const ref = await f.session.resolve({ agentId: agent.identity.id });
    const request = { sessionId: ref.sessionId, idempotencyKey: 'once', message: 'remember' };
    const first = await agent.run(request);
    expect(await agent.run(request)).toEqual(first);
    expect(apply).toHaveBeenCalledOnce();
    expect((await f.service.readCheckpoint(ref, first.requestId))?.final.revision).toBe(2);
    expect(await f.session.listPendingMemoryRecords(ref)).toEqual([]);
  } finally {
    f.store.close();
  }
});

it('archive and restore preserve bindings; Session purge does not pretend to erase Memory history', async () => {
  const f = runtimeMemoryFixture();
  try {
    const agent = createDeterministicAgentAPI({
      identity: { id: 'lifecycle' },
      session: f.session,
      contextMemory: f.service,
      provider: { responses: [{ status: 'success', text: 'ok' }] },
    });
    const first = await agent.run({ message: 'hi' });
    const ref = { agentId: agent.identity.id, sessionId: first.sessionId };
    const checkpoint = await f.service.readCheckpoint(ref, first.requestId);
    if (checkpoint === undefined) throw new Error('Missing checkpoint');
    await f.session.retireSession({ ...ref, expectedRevision: 0 });
    expect(await f.service.readCheckpoint(ref, first.requestId)).toEqual(checkpoint);
    await f.session.restoreSession({ ...ref, expectedRevision: 1 });
    expect(await f.service.readCheckpoint(ref, first.requestId)).toEqual(checkpoint);
    await f.session.retireSession({ ...ref, expectedRevision: 2 });
    await f.session.purgeSession({
      ...ref,
      expectedRevision: 3,
      confirmation: 'permanently-delete-session',
    });
    expect(await f.session.inspectSession(ref)).toBeUndefined();
    expect(
      (await f.memory.workflows.inspectVersion.run({ input: checkpoint.input }))?.revision
    ).toBe(1);
  } finally {
    f.store.close();
  }
});

it('requires an authorized Session recovery CAS before resolving Memory, then repairs all domains', async () => {
  const f = runtimeMemoryFixture();
  try {
    const persistence = createMemorySessionPersistence();
    const session = persistence.session;
    if (!supportsSessionMemoryNavigation(session)) throw new Error('Missing Session extension');
    const resolved = await session.resolve({ agentId: parseAgentId('recover-owner') });
    const ref = { agentId: resolved.agentId, sessionId: resolved.sessionId };
    await session.writeMemoryRecord({
      ...ref,
      kind: 'binding',
      id: resolved.branchId,
      expectedRevision: null,
      settled: false,
      value: JSON.stringify({
        format: 1,
        authorityId: 'test-authority',
        memoryId: 'pending-document',
      }),
    });
    const memory = createSessionContextMemory({
      authorityId: 'test-authority',
      session,
      memory: f.memory.workflows,
    });
    const resolveMemory = vi.fn(() => Promise.resolve(memory));
    const before = await session.inspectSession(ref);
    if (before === undefined) throw new Error('Missing Session');
    await expect(
      persistence.maintenance.recoverSessionPersistence({
        ...ref,
        expectedExecutionRevision: before.execution.revision,
      })
    ).rejects.toBeDefined();
    await expect(
      recoverSessionWithContextMemory(
        { session, maintenance: persistence.maintenance, resolveMemory },
        { ...ref, expectedExecutionRevision: before.execution.revision }
      )
    ).rejects.toBeDefined();
    expect(resolveMemory).not.toHaveBeenCalled();
    const fenced = await session.inspectSession(ref);
    if (fenced === undefined) throw new Error('Missing fence');
    expect(
      await recoverSessionWithContextMemory(
        { session, maintenance: persistence.maintenance, resolveMemory },
        { ...ref, expectedExecutionRevision: fenced.execution.revision }
      )
    ).toMatchObject({ state: 'ready', pendingWorkCount: 0 });
    expect(resolveMemory).toHaveBeenCalledOnce();
    expect(
      (await f.memory.workflows.inspect.run({ input: { memoryId: 'pending-document' } }))?.revision
    ).toBe(1);
  } finally {
    f.store.close();
  }
});
