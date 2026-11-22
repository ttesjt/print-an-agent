import { expect, it } from 'vitest';

import { createMemoryCompactDefinition } from '@print-an-agent/context-memory';

import { modelFixture, firstId } from '../../../support/model.js';

it('observes structured experience, preserves metadata, and replays without another model call', async () => {
  const fixture = modelFixture((request) => [
    { op: 'replace', itemId: firstId(request), content: 'prefers tea' },
  ]);
  await fixture.bundle.workflows.create.run({
    input: {
      memoryId: 'a',
      requestId: 'create',
      items: [{ content: 'prefers coffee', metadata: { private: 'not-a-model-field' } }],
    },
  });
  const input = {
    memoryId: 'a',
    requestId: 'observe',
    context: [{ role: 'user', content: 'I now prefer tea.', source: { turn: 'turn-1' } }],
  };
  const result = await fixture.bundle.workflows.observe.run({ input });
  expect(await fixture.bundle.workflows.observe.run({ input })).toEqual(result);
  expect(fixture.requests).toHaveLength(1);
  expect(fixture.requests[0]?.context).toEqual(input.context);
  expect(JSON.stringify(fixture.requests)).not.toContain('not-a-model-field');
  expect((await fixture.store.read('a'))?.items[0]).toMatchObject({
    content: 'prefers tea',
    metadata: { private: 'not-a-model-field' },
  });
});

it('keeps candidate/source distinct and reaches the safe target, not merely the hard limit', async () => {
  const fixture = modelFixture(
    (request, call) => [
      {
        op: 'replace',
        itemId: firstId(request),
        content: 'x'.repeat(call === 1 ? 20 : call === 2 ? 9 : 8),
      },
    ],
    { defaults: { maxContextTokens: 10 } }
  );
  await fixture.bundle.workflows.create.run({
    input: { memoryId: 'a', requestId: 'create', items: [{ content: 'original' }] },
  });
  await fixture.bundle.workflows.edit.run({
    input: { memoryId: 'a', requestId: 'edit', instruction: 'update this' },
  });
  expect(fixture.requests.map((request) => [request.task, request.targetTokens])).toEqual([
    ['edit', undefined],
    ['compact', 8],
    ['compact', 6],
  ]);
  expect(fixture.requests[2]?.items[0]?.content).toBe('x'.repeat(9));
  expect(fixture.requests[2]?.source[0]?.content).toBe('original');
  expect((await fixture.store.read('a'))?.revision).toBe(2);
  expect((await fixture.store.read('a'))?.items[0]?.content).toBe('x'.repeat(8));
  expect(await fixture.store.getReceipt('a', 'edit')).toMatchObject({
    changes: { updatedItemIds: ['item-1'] },
  });
});

it('merges globally when separator overhead dominates, without revealing renderer internals', async () => {
  const fixture = modelFixture(
    (request, call) =>
      call === 1
        ? []
        : [
            { op: 'replace', itemId: firstId(request), content: 'facts' },
            ...request.items.slice(1).map((item) => ({ op: 'remove' as const, itemId: item.id })),
          ],
    { defaults: { maxContextTokens: 30, render: { format: 'text', separator: 'XXXXXXXXXX' } } }
  );
  await fixture.bundle.workflows.create.run({
    input: {
      memoryId: 'a',
      requestId: 'create',
      items: [{ content: 'a' }, { content: 'b' }, { content: 'c' }],
    },
  });
  await fixture.bundle.workflows.compact.run({
    input: { memoryId: 'a', requestId: 'compact', target: { maxTokens: 10 } },
  });
  expect(fixture.requests.map((request) => request.targetTokens)).toEqual([10, 1]);
  expect(JSON.stringify(fixture.requests)).not.toMatch(
    /separator|XXXXXXXXXX|measurementRef|actualTokens|metadata/
  );
  expect((await fixture.store.read('a'))?.items).toHaveLength(1);
});

it.each(['unchanged', 'growing'] as const)(
  'exhausts three generations for %s candidates without publishing',
  async (mode) => {
    const fixture = modelFixture((request, call) =>
      mode === 'unchanged'
        ? []
        : [{ op: 'replace', itemId: firstId(request), content: 'x'.repeat(20 + call) }]
    );
    await fixture.bundle.workflows.create.run({
      input: { memoryId: 'a', requestId: 'create', items: [{ content: 'x'.repeat(20) }] },
    });
    await expect(
      fixture.bundle.workflows.compact.run({
        input: { memoryId: 'a', requestId: 'compact', target: { maxTokens: 10 } },
      })
    ).rejects.toMatchObject({
      code: 'COMPACTION_EXHAUSTED',
      details: { passes: 3, targetTokens: 10 },
      commit: { status: 'not-committed' },
    });
    expect(fixture.requests).toHaveLength(3);
    expect((await fixture.store.read('a'))?.revision).toBe(1);
    expect(await fixture.store.getReceipt('a', 'compact')).toBeUndefined();
  }
);

it('returns unchanged without a model when already compact, and refuses forced clearing', async () => {
  const fixture = modelFixture((request) =>
    request.items.map((item) => ({ op: 'remove' as const, itemId: item.id }))
  );
  await fixture.bundle.workflows.create.run({
    input: { memoryId: 'a', requestId: 'create', items: [{ content: 'text' }] },
  });
  expect(
    await fixture.bundle.workflows.compact.run({
      input: { memoryId: 'a', requestId: 'no-op', target: { maxTokens: 4 } },
    })
  ).toMatchObject({ status: 'unchanged' });
  expect(fixture.requests).toHaveLength(0);
  await expect(
    fixture.bundle.workflows.compact.run({
      input: { memoryId: 'a', requestId: 'clear', target: { maxTokens: 1 } },
    })
  ).rejects.toMatchObject({ code: 'MODEL_OUTPUT_INVALID' });
  expect((await fixture.store.read('a'))?.items).toHaveLength(1);
});

it('cannot bypass publication limits by replacing candidate assessment', async () => {
  const fixture = modelFixture(() => [], {
    workflows: {
      compact: createMemoryCompactDefinition({
        stepOverrides: {
          assessCandidate: (context) => {
            context.state.assessment = {
              accepted: true,
              actualTokens: 0,
              contentTokens: 0,
              violations: [],
            };
            return Promise.resolve();
          },
        },
      }),
    },
  });
  await fixture.bundle.workflows.create.run({
    input: { memoryId: 'a', requestId: 'create', items: [{ content: 'too long' }] },
  });
  await expect(
    fixture.bundle.workflows.compact.run({
      input: { memoryId: 'a', requestId: 'compact', target: { maxTokens: 1 } },
    })
  ).rejects.toMatchObject({ code: 'BUDGET_EXCEEDED' });
  expect(fixture.requests).toHaveLength(0);
  expect((await fixture.store.read('a'))?.revision).toBe(1);
});
