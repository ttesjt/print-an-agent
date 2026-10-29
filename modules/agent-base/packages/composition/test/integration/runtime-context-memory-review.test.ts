import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, onTestFinished, vi } from 'vitest';
import { SqliteSessionAdapter } from '@ta-agent/base-local-adapters';
import { AgentSessionError, executeSessionNavigation } from '@ta-agent/base-session';
import {
  ContextMemoryError,
  createMemoryApplyDefinition,
  createMemoryForkDefinition,
} from '@ta-agent/context-memory';
import type { VersionedMemoryWorkflowDefinitions } from '@ta-agent/context-memory';
import { skipWorkflow } from '@ta-agent/workflow-core';
import { parseAgentId } from '@ta-agent/base-identity';
import { createDeterministicAgentAPI } from '../../src/index.js';
import { MemoryJournal } from '../../src/management/context-memory/journal.js';
import { runtimeMemoryFixture, memoryToolPermissions } from '../support/runtime-context-memory.js';

async function fixture(
  storage: 'memory' | 'sqlite',
  workflows?: Partial<VersionedMemoryWorkflowDefinitions>
) {
  const directory = await mkdtemp(join(tmpdir(), 'runtime-memory-review-'));
  onTestFinished(() => rm(directory, { recursive: true, force: true }));
  const f = runtimeMemoryFixture(
    true,
    workflows,
    storage === 'sqlite'
      ? new SqliteSessionAdapter({ databasePath: join(directory, 'sessions.sqlite') })
      : undefined
  );
  onTestFinished(() => f.store.close());
  return f;
}

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

  it(`${storage}: stale or absent journal versions cannot update another intent`, async () => {
    const f = await fixture(storage);
    const ref = await f.session.resolve({ agentId: parseAgentId('journal-cas') });
    const journal = new MemoryJournal(f.session, ref);
    const original = await journal.put('mutation', 'cas', { input: 'original' }, false);
    const updated = await journal.put('mutation', 'cas', { input: 'updated' }, false, original);
    await expect(
      journal.put('mutation', 'cas', { input: 'overwrite' }, false)
    ).rejects.toMatchObject({
      code: 'SESSION_MEMORY_CONFLICT',
    });
    await expect(
      journal.put('mutation', 'cas', { input: 'overwrite' }, false, original)
    ).rejects.toMatchObject({
      code: 'SESSION_MEMORY_CONFLICT',
    });
    expect(await journal.read('mutation', 'cas')).toEqual(updated);
    expect(await journal.put('mutation', 'cas', { input: 'updated' }, false, original)).toEqual(
      updated
    );
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

  for (const sameInput of [false, true]) {
    for (const pauseAt of ['read', 'create'] as const) {
      it(`${storage}: ${pauseAt} race arbitrates ${sameInput ? 'matching' : 'different'} input without overwriting intent`, async () => {
        const f = await fixture(storage);
        const agent = createDeterministicAgentAPI({
          identity: { id: 'intent-race' },
          session: f.session,
          contextMemory: f.service,
          provider: { responses: [{ status: 'success', text: 'ready' }] },
        });
        const first = await agent.run({ message: 'initialize' });
        const ref = { agentId: agent.identity.id, sessionId: first.sessionId };
        const branch = await f.session.resolve(ref);
        const requestId = 'same-request';
        const a = {
          requestId,
          expectedRevision: 1,
          commands: [{ op: 'add' as const, content: 'A' }],
        };
        const b = sameInput ? a : { ...a, commands: [{ op: 'add' as const, content: 'B' }] };
        const paused = Promise.withResolvers<void>();
        const resume = Promise.withResolvers<void>();
        const read = f.session.readMemoryRecord.bind(f.session);
        const write = f.session.writeMemoryRecord.bind(f.session);
        let pause = true;
        if (pauseAt === 'read')
          vi.spyOn(f.session, 'readMemoryRecord').mockImplementation(async (input) => {
            const value = await read(input);
            if (
              pause &&
              input.kind === 'mutation' &&
              input.id === requestId &&
              value === undefined
            ) {
              pause = false;
              paused.resolve();
              await resume.promise;
            }
            return value;
          });
        else
          vi.spyOn(f.session, 'writeMemoryRecord').mockImplementation(async (input) => {
            if (
              pause &&
              input.kind === 'mutation' &&
              input.id === requestId &&
              input.expectedRevision === null
            ) {
              pause = false;
              paused.resolve();
              await resume.promise;
            }
            return write(input);
          });
        const apply = vi.spyOn(f.memory.workflows.apply, 'run');
        const losing = f.service.apply(branch, b);
        const outcome = losing.then(
          (value) => ({ value }),
          (error: unknown) => ({ error })
        );
        await paused.promise;
        try {
          const winner = await f.service.apply(branch, a);
          const originalIntent = await read({ ...ref, kind: 'mutation', id: requestId });
          resume.resolve();
          if (sameInput) expect(await losing).toBe(winner);
          else expect(await outcome).toMatchObject({ error: { code: 'SESSION_MEMORY_CONFLICT' } });
          expect(await read({ ...ref, kind: 'mutation', id: requestId })).toEqual(originalIntent);
          expect(await f.service.apply(branch, a)).toBe(winner);
          expect(apply).toHaveBeenCalledOnce();
          expect((await f.service.inspect(branch))?.items.map((item) => item.content)).toEqual([
            'A',
          ]);
          expect(await f.session.listPendingMemoryRecords(ref)).toEqual([]);
        } finally {
          resume.resolve();
          await outcome;
        }
      });
    }
  }

  it(`${storage}: a matching create race joins a pending intent without invoking apply again`, async () => {
    const f = await fixture(storage);
    const agent = createDeterministicAgentAPI({
      identity: { id: 'pending-race' },
      session: f.session,
      contextMemory: f.service,
      provider: { responses: [{ status: 'success', text: 'ready' }] },
    });
    const first = await agent.run({ message: 'initialize' });
    const ref = { agentId: agent.identity.id, sessionId: first.sessionId };
    const branch = await f.session.resolve(ref);
    const input = {
      requestId: 'pending',
      expectedRevision: 1,
      commands: [{ op: 'add' as const, content: 'once' }],
    };
    const readPaused = Promise.withResolvers<void>();
    const resumeRead = Promise.withResolvers<void>();
    const applyPaused = Promise.withResolvers<void>();
    const resumeApply = Promise.withResolvers<void>();
    const read = f.session.readMemoryRecord.bind(f.session);
    let pause = true;
    vi.spyOn(f.session, 'readMemoryRecord').mockImplementation(async (key) => {
      const value = await read(key);
      if (pause && key.kind === 'mutation' && key.id === input.requestId && value === undefined) {
        pause = false;
        readPaused.resolve();
        await resumeRead.promise;
      }
      return value;
    });
    const run = f.memory.workflows.apply.run.bind(f.memory.workflows.apply);
    const apply = vi.spyOn(f.memory.workflows.apply, 'run').mockImplementationOnce(async (call) => {
      applyPaused.resolve();
      await resumeApply.promise;
      return run(call);
    });
    const b = f.service.apply(branch, input).then(
      (value) => ({ value }),
      (error: unknown) => ({ error })
    );
    await readPaused.promise;
    const a = f.service.apply(branch, input);
    try {
      await applyPaused.promise;
      resumeRead.resolve();
      expect(await b).toMatchObject({ error: { commit: { status: 'unknown' } } });
      expect(apply).toHaveBeenCalledOnce();
      resumeApply.resolve();
      const committed = await a;
      expect(await f.service.apply(branch, input)).toBe(committed);
      expect(apply).toHaveBeenCalledOnce();
      expect(await f.session.listPendingMemoryRecords(ref)).toEqual([]);
    } finally {
      resumeRead.resolve();
      resumeApply.resolve();
      await Promise.allSettled([a, b]);
    }
  });

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
