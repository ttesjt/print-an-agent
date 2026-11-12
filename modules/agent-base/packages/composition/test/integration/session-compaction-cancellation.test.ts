import { afterEach, expect, it, vi } from 'vitest';
import { supportsSessionExecution } from '@print-an-agent/base-session';
import { compactionFixture } from '../support/compaction-fixture.js';

afterEach(() => vi.useRealTimers());

it.each([
  {
    owner: 'compaction',
    timeoutMilliseconds: 10,
    actorTimeoutMilliseconds: undefined,
    parentFirst: false,
    code: 'SESSION_COMPACTION_TIMEOUT',
  },
  {
    owner: 'Actor with no compaction deadline',
    timeoutMilliseconds: null,
    actorTimeoutMilliseconds: 10,
    parentFirst: false,
    code: 'ACTOR_INVOCATION_TIMEOUT',
  },
  {
    owner: 'Actor with a longer compaction deadline',
    timeoutMilliseconds: 30,
    actorTimeoutMilliseconds: 10,
    parentFirst: false,
    code: 'ACTOR_INVOCATION_TIMEOUT',
  },
  {
    owner: 'parent',
    timeoutMilliseconds: 20,
    actorTimeoutMilliseconds: 10,
    parentFirst: true,
    code: 'SESSION_COMPACTION_CANCELLED',
  },
])(
  'preserves $owner cancellation ownership while Engine cleanup is pending',
  async ({ timeoutMilliseconds, actorTimeoutMilliseconds, parentFirst, code }) => {
    const parent = new AbortController();
    const parentReason = new Error('caller cancelled');
    const entered = Promise.withResolvers<void>();
    const cleaning = Promise.withResolvers<AbortSignal>();
    const release = Promise.withResolvers<void>();
    const fixture = await compactionFixture({
      policy: { timeoutMilliseconds },
      ...(actorTimeoutMilliseconds === undefined ? {} : { actorTimeoutMilliseconds }),
      complete: async (request) => {
        entered.resolve();
        await new Promise<void>((resolve) => {
          request.signal.addEventListener('abort', () => resolve(), { once: true });
        });
        cleaning.resolve(request.signal);
        await release.promise;
        throw new Error('Engine stopped after cleanup', { cause: request.signal.reason });
      },
    });
    const commit = vi.spyOn(fixture.session, 'commitCompaction');
    vi.useFakeTimers();
    const run = fixture.agent.invoke(
      'compactSession',
      { sessionId: fixture.sessionId },
      { signal: parent.signal }
    );
    let settled = false;
    const assertion = expect(run).rejects.toMatchObject({ code });
    void run.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      }
    );
    await entered.promise;
    if (parentFirst) parent.abort(parentReason);
    else await vi.advanceTimersByTimeAsync(10);
    const effectiveSignal = await cleaning.promise;
    const firstReason: unknown = effectiveSignal.reason;
    if (!parentFirst) parent.abort(parentReason);
    await vi.advanceTimersByTimeAsync(30);
    expect(effectiveSignal.reason).toBe(firstReason);
    expect(settled).toBe(false);
    release.resolve();
    await assertion;
    expect(fixture.requests).toHaveLength(1);
    expect(commit).not.toHaveBeenCalled();
    expect(await fixture.session.readCompaction(fixture.reference)).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
    if (!supportsSessionExecution(fixture.session))
      throw new Error('Expected execution capability');
    const lease = await fixture.session.acquireSessionExecution(fixture.reference);
    await fixture.session.releaseSessionExecution(lease);
  }
);

it.each(['caller cancelled', null, Number.NaN])(
  'normalizes parent cancellation with a non-Error reason %s',
  async (reason) => {
    const parent = new AbortController();
    const fixture = await compactionFixture({
      policy: { maxContextTokens: 3, target: { maxTokens: 3 } },
      steps: {
        refineCompactionPlan: (context) => {
          parent.abort(reason);
          context.signal.throwIfAborted();
          return Promise.resolve();
        },
      },
    });
    await expect(
      fixture.agent.invoke(
        'compactSession',
        { sessionId: fixture.sessionId },
        { signal: parent.signal }
      )
    ).rejects.toMatchObject({ code: 'SESSION_COMPACTION_CANCELLED', cause: reason });
    expect(fixture.requests).toHaveLength(1);
    expect(await fixture.session.readCompaction(fixture.reference)).toBeUndefined();
  }
);
