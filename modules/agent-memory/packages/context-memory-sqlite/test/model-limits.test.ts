import { afterEach, expect, it, vi } from 'vitest';
import {
  createContextMemoryBundle,
  createModelMemoryResources,
  MemoryMeter,
  createMemoryCompactDefinition,
} from '@print-an-agent/context-memory';
import {
  createTokenCounter,
  TEXT_TOKEN_INPUT_CONTRACT,
} from '@print-an-agent/model-invocation-core';
import { modelFixture, firstId } from './support/model.js';
import { borrowed } from './support/fixtures.js';
import { testCounter } from './support/counter.js';

afterEach(() => vi.useRealTimers());
it.each([
  { passes: 0, expected: 0 },
  { passes: 1, expected: 1 },
  { passes: null, expected: 5 },
])('honors compaction call limit $passes without an off-by-one', async ({ passes, expected }) => {
  const fixture = modelFixture(
    (request, call) =>
      call === 5 ? [{ op: 'replace', itemId: firstId(request), content: 'x' }] : [],
    { policy: { maxCompactionPasses: passes } }
  );
  await fixture.bundle.workflows.create.run({
    input: { memoryId: 'a', requestId: 'create', items: [{ content: 'long text' }] },
  });
  const run = fixture.bundle.workflows.compact.run({
    input: { memoryId: 'a', requestId: 'compact', target: { maxTokens: 2 } },
  });
  if (passes === null) expect(await run).toMatchObject({ status: 'committed' });
  else
    await expect(run).rejects.toMatchObject({ code: 'COMPACTION_EXHAUSTED', details: { passes } });
  expect(fixture.requests).toHaveLength(expected);
});

it('one deadline covers every generation and cancels cooperative model work', async () => {
  const fixture = modelFixture(
    async (_request, _call, signal) => {
      await new Promise<void>((resolve, reject) => {
        const onAbort = () => {
          clearTimeout(timer);
          reject(new Error('Model work cancelled.', { cause: signal.reason }));
        };
        const timer = setTimeout(() => {
          signal.removeEventListener('abort', onAbort);
          resolve();
        }, 8);
        signal.addEventListener('abort', onAbort, { once: true });
      });
      return [];
    },
    { policy: { timeoutMs: 20, maxCompactionPasses: null } }
  );
  await fixture.bundle.workflows.create.run({
    input: { memoryId: 'a', requestId: 'create', items: [{ content: 'long text' }] },
  });
  vi.useFakeTimers();
  const parent = new AbortController();
  const run = fixture.bundle.workflows.compact.run({
    input: { memoryId: 'a', requestId: 'compact', target: { maxTokens: 2 } },
    signal: parent.signal,
  });
  const assertion = expect(run).rejects.toMatchObject({
    code: 'OPERATION_TIMEOUT',
    commit: { status: 'not-committed' },
  });
  await vi.advanceTimersByTimeAsync(20);
  await assertion;
  expect(fixture.requests).toHaveLength(3);
  expect(parent.signal.aborted).toBe(false);
  expect(vi.getTimerCount()).toBe(0);
  expect(await fixture.store.getReceipt('a', 'compact')).toBeUndefined();
});

it('parent cancellation also terminates explicitly unbounded compaction', async () => {
  const controller = new AbortController();
  const fixture = modelFixture(
    (_request, call) => {
      if (call === 4) controller.abort();
      return [];
    },
    { policy: { maxCompactionPasses: null } }
  );
  await fixture.bundle.workflows.create.run({
    input: { memoryId: 'a', requestId: 'create', items: [{ content: 'long text' }] },
  });
  await expect(
    fixture.bundle.workflows.compact.run({
      input: { memoryId: 'a', requestId: 'compact', target: { maxTokens: 2 } },
      signal: controller.signal,
    })
  ).rejects.toMatchObject({ code: 'OPERATION_ABORTED' });
  expect(fixture.requests).toHaveLength(4);
  expect((await fixture.store.read('a'))?.revision).toBe(1);
});

it.each(['exact', 'estimated'] as const)(
  'checks optional experience budget with %s input evidence before invoking a model',
  async (accuracy) => {
    const base = borrowed();
    let plans = 0;
    const counter = createTokenCounter({
      measurementRef: 'input',
      inputContract: TEXT_TOKEN_INPUT_CONTRACT,
      measure: () => Promise.resolve({ tokens: 100, accuracy }),
    });
    const bundle = createContextMemoryBundle({
      resources: createModelMemoryResources({
        store: base.store,
        meter: base.meter,
        defaults: { measurementRef: 'chars' },
        inputCounter: counter,
        policy: { maxInputTokens: 1 },
        planner: {
          plan: () => {
            plans++;
            return Promise.resolve([]);
          },
        },
      }),
    });
    await bundle.workflows.create.run({ input: { memoryId: 'a', requestId: 'create' } });
    await expect(
      bundle.workflows.observe.run({
        input: {
          memoryId: 'a',
          requestId: 'observe',
          context: [{ role: 'user', content: 'large context' }],
        },
      })
    ).rejects.toMatchObject({
      code: accuracy === 'exact' ? 'BUDGET_EXCEEDED' : 'TOKEN_MEASUREMENT_INEXACT',
    });
    expect(plans).toBe(0);
  }
);

it('rejects unavailable input measurement and invalid timer configuration at assembly', () => {
  const base = borrowed();
  const options = {
    store: base.store,
    meter: base.meter,
    planner: { plan: () => Promise.resolve([]) },
  };
  expect(() => createModelMemoryResources({ ...options, policy: { maxInputTokens: 1 } })).toThrow();
  expect(() =>
    createModelMemoryResources({ ...options, policy: { timeoutMs: 2 ** 32 } })
  ).toThrow();
});

it('supports a replaced named controller and refuses attempts to relax the hard target', async () => {
  const fixture = modelFixture(
    (request, call) =>
      call === 1 ? [] : [{ op: 'replace', itemId: firstId(request), content: 'x' }],
    {
      workflows: {
        compact: createMemoryCompactDefinition({
          stepOverrides: {
            refineCompactionPlan: (context) => {
              context.state.plannerTargetTokens = 2;
              return Promise.resolve();
            },
          },
        }),
      },
    }
  );
  await fixture.bundle.workflows.create.run({
    input: { memoryId: 'a', requestId: 'create', items: [{ content: 'long text' }] },
  });
  await fixture.bundle.workflows.compact.run({
    input: { memoryId: 'a', requestId: 'compact', target: { maxTokens: 4 } },
  });
  expect(fixture.requests.map((request) => request.targetTokens)).toEqual([4, 2]);
  const base = borrowed();
  const bad = createContextMemoryBundle({
    resources: createModelMemoryResources({
      store: base.store,
      meter: new MemoryMeter({ counter: testCounter() }),
      defaults: { measurementRef: 'chars' },
      planner: { plan: () => Promise.resolve([]) },
      refine: () => 1000,
    }),
  });
  await bad.workflows.create.run({
    input: { memoryId: 'a', requestId: 'create', items: [{ content: 'long text' }] },
  });
  await expect(
    bad.workflows.compact.run({
      input: { memoryId: 'a', requestId: 'compact', target: { maxTokens: 4 } },
    })
  ).rejects.toMatchObject({ code: 'CONFIG_INVALID' });
});
