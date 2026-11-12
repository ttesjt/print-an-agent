import { expect, it } from 'vitest';
import {
  createContextMemoryBundle,
  createModelMemoryResources,
  MemoryMeter,
} from '@print-an-agent/context-memory';
import { modelFixture, firstId } from './support/model.js';
import { borrowed } from './support/fixtures.js';
import { testCounter } from './support/counter.js';

it('supports a future JSON render budget without changing the stored text configuration', async () => {
  const fixture = modelFixture(
    (request) => [{ op: 'replace', itemId: firstId(request), content: 'x' }],
    { defaults: { maxContextTokens: 6 } }
  );
  await fixture.bundle.workflows.create.run({
    input: { memoryId: 'a', requestId: 'create', items: [{ content: 'hello' }] },
  });
  const target = JSON.stringify([{ id: 'item-1', content: 'x' }]).length;
  await fixture.bundle.workflows.compact.run({
    input: {
      memoryId: 'a',
      requestId: 'compact',
      target: { maxTokens: target, render: { format: 'json' } },
    },
  });
  const snapshot = await fixture.store.read('a');
  expect(snapshot?.config.render).toEqual({ format: 'text', separator: '\n' });
  expect(snapshot?.config.maxContextTokens).toBe(6);
  expect(snapshot?.items[0]?.content).toBe('x');
});

it('requires both document and alternate measurement targets, without comparing unlike token counts', async () => {
  const base = borrowed();
  const targets: number[] = [];
  const canonical = testCounter((text) => Promise.resolve(text.length * 10), 'canonical');
  const alternate = testCounter(
    (text) => Promise.resolve(text === 'longer' ? 1 : text.length * 5),
    'alternate'
  );
  const meter = new MemoryMeter({
    resolveCounter: (ref) => {
      if (ref === 'canonical') return canonical;
      if (ref === 'alternate') return alternate;
      throw new Error('unknown counter');
    },
  });
  const bundle = createContextMemoryBundle({
    resources: createModelMemoryResources({
      store: base.store,
      meter,
      defaults: { measurementRef: 'canonical', maxContextTokens: 50 },
      planner: {
        plan: (request) => {
          targets.push(request.targetTokens ?? 0);
          return Promise.resolve([
            {
              op: 'replace',
              itemId: firstId(request),
              content: targets.length === 1 ? 'longer' : 'bb',
            },
          ]);
        },
      },
    }),
  });
  await bundle.workflows.create.run({
    input: { memoryId: 'a', requestId: 'create', items: [{ content: 'aaaa' }] },
  });
  await bundle.workflows.compact.run({
    input: {
      memoryId: 'a',
      requestId: 'compact',
      target: { maxTokens: 15, measurementRef: 'alternate' },
    },
  });
  expect(targets).toEqual([15, 1]);
  const snapshot = await base.store.read('a');
  expect(snapshot?.measurement.tokens).toBe(20);
  expect(snapshot?.measurement.measurementRef).toBe('canonical');
  expect(snapshot?.config.measurementRef).toBe('canonical');
  expect(snapshot?.revision).toBe(2);
});

it('rejects missing/invalid targets and unavailable counters without changing the document', async () => {
  const fixture = modelFixture(() => [], { defaults: { maxContextTokens: null } });
  await fixture.bundle.workflows.create.run({
    input: { memoryId: 'a', requestId: 'create', items: [{ content: 'hello' }] },
  });
  await expect(
    fixture.bundle.workflows.compact.run({ input: { memoryId: 'a', requestId: 'missing' } })
  ).rejects.toMatchObject({ code: 'CONFIG_INVALID' });
  await expect(
    fixture.bundle.workflows.compact.run({
      input: {
        memoryId: 'a',
        requestId: 'counter',
        target: { maxTokens: 1, measurementRef: 'missing' },
      },
    })
  ).rejects.toMatchObject({ code: 'TOKENIZER_UNAVAILABLE' });
  expect(fixture.requests).toHaveLength(0);
  const finite = modelFixture(() => [], { defaults: { maxContextTokens: 10 } });
  await finite.bundle.workflows.create.run({ input: { memoryId: 'a', requestId: 'create' } });
  await expect(
    finite.bundle.workflows.compact.run({
      input: { memoryId: 'a', requestId: 'too-large', target: { maxTokens: 11 } },
    })
  ).rejects.toMatchObject({ code: 'CONFIG_INVALID' });
});

it('resolves calculated targets and explicit targets for unbounded documents', async () => {
  const fixture = modelFixture(
    (request) => [{ op: 'replace', itemId: firstId(request), content: 'ok' }],
    { defaults: { maxContextTokens: null } }
  );
  await fixture.bundle.workflows.create.run({
    input: { memoryId: 'a', requestId: 'create', items: [{ content: 'x'.repeat(20) }] },
  });
  await fixture.bundle.workflows.compact.run({
    input: {
      memoryId: 'a',
      requestId: 'compact',
      target: { limitTokens: 20, ratio: 0.5, reserveTokens: 2 },
    },
  });
  expect(fixture.requests[0]?.targetTokens).toBe(8);
  expect((await fixture.store.read('a'))?.config.maxContextTokens).toBeNull();
});

it('keeps structural and per-item limits even when total tokens fit the target', async () => {
  const fixture = modelFixture(
    (request) =>
      request.task === 'edit'
        ? [{ op: 'add', content: '123456' }]
        : [
            { op: 'replace', itemId: firstId(request), content: 'both' },
            ...request.items.slice(1).map((item) => ({ op: 'remove' as const, itemId: item.id })),
          ],
    { defaults: { maxContextTokens: 100, maxItems: 1, maxItemTokens: 5 } }
  );
  await fixture.bundle.workflows.create.run({
    input: { memoryId: 'a', requestId: 'create', items: [{ content: 'first' }] },
  });
  await fixture.bundle.workflows.edit.run({
    input: { memoryId: 'a', requestId: 'edit', instruction: 'learn' },
  });
  expect(fixture.requests.map((request) => request.task)).toEqual(['edit', 'compact']);
  expect((await fixture.store.read('a'))?.items.map((item) => item.content)).toEqual(['both']);
});
