import { afterEach, expect, it, vi } from 'vitest';
import { ModelInvocationError } from '@print-an-agent/model-invocation-core';
import { supportsSessionExecution, parseTurnId } from '@print-an-agent/base-session';
import { compactionFixture, compactionMessage } from '../support/compaction-fixture.js';
import { testCompactionCounter } from '../support/compaction-token-counter.js';

afterEach(() => vi.useRealTimers());

it.each([1, 4])(
  'honors an explicitly configured generation bound of %s',
  async (maxGenerationAttempts) => {
    const fixture = await compactionFixture({
      policy: { maxContextTokens: 3, target: { maxTokens: 3 }, maxGenerationAttempts },
    });
    await expect(
      fixture.agent.invoke('compactSession', { sessionId: fixture.sessionId })
    ).rejects.toMatchObject({
      code: 'SESSION_COMPACTION_ATTEMPTS_EXHAUSTED',
      generationAttempts: maxGenerationAttempts,
    });
    expect(fixture.requests).toHaveLength(maxGenerationAttempts);
  }
);

it('publishes exactly the text it measured even when a custom draft is mutable', async () => {
  const draft = { role: 'context' as const, text: 'ok', timestamp: 1 };
  const fixture = await compactionFixture({
    policy: { maxContextTokens: 3, target: { maxTokens: 3 } },
    steps: {
      buildCompactedContext: (context) => {
        context.state.compactedContext = draft;
        return Promise.resolve();
      },
    },
    counter: testCompactionCounter((text) => {
      draft.text = 'changed after measurement';
      return Promise.resolve(text.length);
    }),
  });
  await fixture.agent.invoke('compactSession', { sessionId: fixture.sessionId });
  expect((await fixture.session.readCompaction(fixture.reference))?.context.text).toBe('ok');
  expect(fixture.requests).toHaveLength(0);
});

it('does not claim rollback or retry when cancellation races an already-started commit', async () => {
  const fixture = await compactionFixture();
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const parent = new AbortController();
  const originalCommit = fixture.session.commitCompaction.bind(fixture.session);
  const commit = vi
    .spyOn(fixture.session, 'commitCompaction')
    .mockImplementation(async (request) => {
      entered.resolve();
      await release.promise;
      return originalCommit(request);
    });
  const run = fixture.agent.invoke(
    'compactSession',
    { sessionId: fixture.sessionId },
    { signal: parent.signal }
  );
  const assertion = expect(run).resolves.toMatchObject({ status: 'compacted', revision: 1 });
  await entered.promise;
  parent.abort(new Error('cancel during non-cancellable I/O'));
  release.resolve();
  await assertion;
  expect(await fixture.session.readCompaction(fixture.reference)).toMatchObject({
    revision: 1,
    context: { text: 'summary' },
  });
  expect(commit).toHaveBeenCalledTimes(1);
  expect(fixture.requests).toHaveLength(1);
});

it('waits for in-flight non-cancellable commit I/O and exposes deadline commit ambiguity', async () => {
  const fixture = await compactionFixture({ policy: { timeoutMilliseconds: 10 } });
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const originalCommit = fixture.session.commitCompaction.bind(fixture.session);
  const commit = vi
    .spyOn(fixture.session, 'commitCompaction')
    .mockImplementation(async (request) => {
      entered.resolve();
      await release.promise;
      return originalCommit(request);
    });
  vi.useFakeTimers();
  let settled = false;
  const run = fixture.agent.invoke('compactSession', { sessionId: fixture.sessionId });
  void run.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    }
  );
  const assertion = expect(run).rejects.toMatchObject({ code: 'SESSION_COMPACTION_TIMEOUT' });
  await entered.promise;
  await vi.advanceTimersByTimeAsync(10);
  expect(settled).toBe(false);
  release.resolve();
  await assertion;
  expect(await fixture.session.readCompaction(fixture.reference)).toMatchObject({ revision: 1 });
  expect(commit).toHaveBeenCalledTimes(1);
  expect(fixture.requests).toHaveLength(1);
});

it('runs a replacement refinement Step instead of the default feedback formula', async () => {
  let calls = 0;
  let refinements = 0;
  // Use a contextually typed Step so the replacement remains checked against the public contract.
  const fixture = await compactionFixture({
    policy: { maxContextTokens: 30, target: { maxTokens: 30 } },
    complete: () =>
      Promise.resolve({ message: compactionMessage(++calls === 1 ? 'x'.repeat(45) : 'ok') }),
    steps: {
      refineCompactionPlan: (context) => {
        refinements++;
        context.state.plannerTargetTokens = 2;
        return Promise.resolve();
      },
    },
  });
  await fixture.agent.invoke('compactSession', { sessionId: fixture.sessionId });
  expect(fixture.requests[1]?.messages.at(-1)?.text).toContain('2 tokens');
  expect(refinements).toBe(1);
});

it('stops between passes on parent cancellation and releases execution occupancy', async () => {
  const parent = new AbortController();
  const fixture = await compactionFixture({
    policy: { maxContextTokens: 3, target: { maxTokens: 3 } },
    steps: {
      refineCompactionPlan: () => {
        parent.abort(new Error('user cancelled'));
        return Promise.resolve();
      },
    },
  });
  const commit = vi.spyOn(fixture.session, 'commitCompaction');
  await expect(
    fixture.agent.invoke(
      'compactSession',
      { sessionId: fixture.sessionId },
      { signal: parent.signal }
    )
  ).rejects.toMatchObject({ code: 'SESSION_COMPACTION_CANCELLED' });
  expect(fixture.requests).toHaveLength(1);
  expect(commit).not.toHaveBeenCalled();
  if (supportsSessionExecution(fixture.session)) {
    const lease = await fixture.session.acquireSessionExecution(fixture.reference);
    await fixture.session.releaseSessionExecution(lease);
  }
});

it('cancels the actual counter and starts no additional generation', async () => {
  const started = Promise.withResolvers<void>();
  const parent = new AbortController();
  const fixture = await compactionFixture({
    counter: testCompactionCounter(
      (_text, signal) =>
        new Promise((_, reject) => {
          signal.addEventListener(
            'abort',
            () => reject(new Error('counter stopped', { cause: signal.reason })),
            { once: true }
          );
          started.resolve();
        })
    ),
  });
  const run = fixture.agent.invoke(
    'compactSession',
    { sessionId: fixture.sessionId },
    { signal: parent.signal }
  );
  const assertion = expect(run).rejects.toMatchObject({ code: 'SESSION_COMPACTION_CANCELLED' });
  await started.promise;
  parent.abort(new Error('cancel'));
  await assertion;
  expect(fixture.requests).toHaveLength(1);
});

it('does not reset the deadline when a second generation starts', async () => {
  let calls = 0;
  const fixture = await compactionFixture({
    policy: { timeoutMilliseconds: 20, maxContextTokens: 3, target: { maxTokens: 3 } },
    complete: (request) =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          request.signal.removeEventListener('abort', abort);
          resolve({ message: compactionMessage(++calls === 1 ? 'too long' : 'ok') });
        }, 12);
        const abort = () => {
          clearTimeout(timer);
          reject(new Error('stopped', { cause: request.signal.reason }));
        };
        request.signal.addEventListener('abort', abort, { once: true });
      }),
  });
  vi.useFakeTimers();
  const run = fixture.agent.invoke('compactSession', { sessionId: fixture.sessionId });
  const assertion = expect(run).rejects.toMatchObject({ code: 'SESSION_COMPACTION_TIMEOUT' });
  await vi.advanceTimersByTimeAsync(20);
  await assertion;
  expect(fixture.requests).toHaveLength(2);
  expect(vi.getTimerCount()).toBe(0);
});

it('preserves a narrower Actor deadline instead of relabelling it', async () => {
  const fixture = await compactionFixture({
    actorTimeoutMilliseconds: 10,
    policy: { timeoutMilliseconds: 30 },
    complete: (request) =>
      new Promise((_, reject) => {
        request.signal.addEventListener('abort', () => reject(new Error('actor stopped')), {
          once: true,
        });
      }),
  });
  vi.useFakeTimers();
  const run = fixture.agent.invoke('compactSession', { sessionId: fixture.sessionId });
  const assertion = expect(run).rejects.toMatchObject({ code: 'ACTOR_INVOCATION_TIMEOUT' });
  await vi.advanceTimersByTimeAsync(10);
  await assertion;
  expect(fixture.requests).toHaveLength(1);
  expect(vi.getTimerCount()).toBe(0);
});

it('preserves existing projection authority after exhaustion', async () => {
  const fixture = await compactionFixture({
    policy: {
      minimumCompletedTurns: 2,
      retainRecentTurns: 1,
      maxContextTokens: 3,
      target: { maxTokens: 3 },
    },
  });
  if (!supportsSessionExecution(fixture.session)) throw new Error('Expected execution capability');
  const lease = await fixture.session.acquireSessionExecution(fixture.reference);
  await fixture.session.commitCompaction({
    ...fixture.reference,
    expectedRevision: 0,
    throughTurnId: parseTurnId('turn-1'),
    context: { role: 'context', text: 'old', timestamp: 1 },
    execution: lease,
  });
  await fixture.session.releaseSessionExecution(lease);
  await expect(
    fixture.agent.invoke('compactSession', { sessionId: fixture.sessionId })
  ).rejects.toMatchObject({ code: 'SESSION_COMPACTION_ATTEMPTS_EXHAUSTED' });
  expect(await fixture.session.readCompaction(fixture.reference)).toMatchObject({
    revision: 1,
    throughTurnId: 'turn-1',
    context: { text: 'old' },
  });
});

it('does not automatically retry a protocol failure', async () => {
  const cause = new ModelInvocationError('MODEL_RUNTIME_PROTOCOL_INVALID', 'invalid');
  const fixture = await compactionFixture({ complete: () => Promise.reject(cause) });
  await expect(
    fixture.agent.invoke('compactSession', { sessionId: fixture.sessionId })
  ).rejects.toMatchObject({ code: 'SESSION_COMPACTION_RUNTIME_FAILED', cause });
  expect(fixture.requests).toHaveLength(1);
});

it.each(['null', 'unknown field', 'getter'])(
  'rejects %s compaction input before Session inspection through the shared domain parser',
  async (kind) => {
    const fixture = await compactionFixture();
    const inspect = vi.spyOn(fixture.session, 'inspect');
    const getter = vi.fn(() => fixture.sessionId);
    const input: unknown =
      kind === 'null'
        ? null
        : kind === 'unknown field'
          ? { sessionId: fixture.sessionId, extra: true }
          : Object.defineProperty({}, 'sessionId', { enumerable: true, get: getter });
    await expect(
      fixture.agent.invoke(
        'compactSession',
        // @ts-expect-error Exercise a JavaScript caller's unknown business input.
        input
      )
    ).rejects.toMatchObject({ code: 'SESSION_COMPACTION_INVALID' });
    expect(getter).not.toHaveBeenCalled();
    expect(inspect).not.toHaveBeenCalled();
    expect(fixture.requests).toHaveLength(0);
  }
);
