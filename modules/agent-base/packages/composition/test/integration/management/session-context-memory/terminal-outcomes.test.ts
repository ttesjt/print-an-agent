import { executeSessionNavigation } from '@print-an-agent/base-session';
import {
  createMemoryApplyDefinition,
  createMemoryForkDefinition,
} from '@print-an-agent/context-memory';
import { skipWorkflow } from '@print-an-agent/workflow-core';
import { expect, it, vi } from 'vitest';
import { createDeterministicAgentAPI } from '../../../../src/index.js';
import { memoryToolPermissions } from '../../../support/management/runtime-context-memory.js';
import { storedRuntimeMemoryFixture as fixture } from '../../../support/management/session-context-memory-storage.js';
for (const storage of ['memory', 'sqlite'] as const) {
  it(`${storage}: a native apply skip settles, replays, and permits the next runtime Turn`, async () => {
    const f = await fixture(storage, {
      apply: createMemoryApplyDefinition({ condition: () => skipWorkflow('disabled') }),
    });
    const apply = vi.spyOn(f.memory.workflows.apply, 'run');
    const agent = createDeterministicAgentAPI({
      identity: { id: 'skip-tool' },
      session: f.session,
      contextMemory: f.service,
      ...memoryToolPermissions(),
      provider: {
        responses: [
          {
            status: 'tool-call',
            name: 'apply_context_memory',
            callId: 'skip',
            arguments: {
              expectedRevision: 1,
              commands: [{ op: 'add', itemId: '', content: 'not stored' }],
            },
          },
          { status: 'success', text: 'not stored' },
          { status: 'success', text: 'next' },
        ],
      },
    });
    const first = await agent.run({ message: 'attempt' });
    const ref = { agentId: agent.identity.id, sessionId: first.sessionId };
    const checkpoint = await f.service.readCheckpoint(ref, first.requestId);
    expect(checkpoint?.final).toEqual(checkpoint?.input);
    expect(checkpoint?.settled).toBe(true);
    expect(await f.session.listPendingMemoryRecords(ref)).toEqual([]);
    const branch = await f.session.resolve(ref);
    const input = {
      requestId: 'skip-edit',
      expectedRevision: 1,
      commands: [{ op: 'add' as const, content: 'not stored' }],
    };
    const skipped = await f.service.apply(branch, input);
    expect(JSON.parse(skipped) as unknown).toMatchObject({ status: 'skipped' });
    const getReceipt = vi.spyOn(f.memory.workflows.getReceipt, 'run');
    expect(await f.service.apply(branch, input)).toBe(skipped);
    await f.service.recover(ref);
    expect(getReceipt).not.toHaveBeenCalled();
    expect(apply).toHaveBeenCalledTimes(2);
    expect((await f.service.inspect(branch))?.revision).toBe(1);
    expect(await f.session.listPendingMemoryRecords(ref)).toEqual([]);
    expect(
      (await agent.run({ sessionId: first.sessionId, message: 'continue' })).message.text
    ).toBe('next');
  });

  it(`${storage}: a native fork skip is terminal rather than an unknown derivation`, async () => {
    const f = await fixture(storage, {
      fork: createMemoryForkDefinition({ condition: () => skipWorkflow('disabled') }),
    });
    const agent = createDeterministicAgentAPI({
      identity: { id: 'skip-fork' },
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
      code: 'SESSION_MEMORY_NOT_CONFIGURED',
      commit: { status: 'not-committed' },
    });
    expect(await f.session.listPendingMemoryRecords(ref)).toEqual([]);
    await f.service.recover(ref);
    expect(
      (await agent.run({ sessionId: first.sessionId, message: 'continue' })).message.text
    ).toBe('two');
  });

  it(`${storage}: a known native skip is not changed into unknown by late cancellation`, async () => {
    const f = await fixture(storage, {
      apply: createMemoryApplyDefinition({ condition: () => skipWorkflow('disabled') }),
    });
    const agent = createDeterministicAgentAPI({
      identity: { id: 'cancel-skip' },
      session: f.session,
      contextMemory: f.service,
      provider: { responses: [{ status: 'success', text: 'ready' }] },
    });
    const first = await agent.run({ message: 'initialize' });
    const ref = { agentId: agent.identity.id, sessionId: first.sessionId };
    const branch = await f.session.resolve(ref);
    const abort = new AbortController();
    const run = f.memory.workflows.apply.run.bind(f.memory.workflows.apply);
    vi.spyOn(f.memory.workflows.apply, 'run').mockImplementationOnce(async (input) => {
      const result = await run(input);
      abort.abort();
      return result;
    });
    const result = JSON.parse(
      await f.service.apply(
        branch,
        {
          requestId: 'skip-cancel',
          expectedRevision: 1,
          commands: [{ op: 'add', content: 'not stored' }],
        },
        abort.signal
      )
    ) as unknown;
    expect(result).toMatchObject({ status: 'skipped' });
    expect((await f.service.inspect(branch))?.revision).toBe(1);
    expect(await f.session.listPendingMemoryRecords(ref)).toEqual([]);
    await f.service.recover(ref);
  });
}
