import { expect, it, vi } from 'vitest';
import { createDeterministicAgentAPI } from '../../../../src/index.js';
import { storedRuntimeMemoryFixture as fixture } from '../../../support/management/session-context-memory-storage.js';
for (const storage of ['memory', 'sqlite'] as const) {
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
}
