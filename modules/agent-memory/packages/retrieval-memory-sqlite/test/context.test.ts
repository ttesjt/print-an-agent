import {
  createTokenCounter,
  TEXT_TOKEN_INPUT_CONTRACT,
} from '@print-an-agent/model-invocation-core';
import {
  createRetrievalContext,
  createRetrievalQueries,
  createRetrievalMemoryBundle,
  createRetrievalWorkflowResources,
  createRetrievalReadContextDefinition,
} from '@print-an-agent/retrieval-memory';
import { expect, it } from 'vitest';
import { fixture } from './support/fixture.js';
function counter(nonadditive = false, estimated = false) {
  return createTokenCounter({
    measurementRef: `test-text:${nonadditive}:${estimated}`,
    inputContract: TEXT_TOKEN_INPUT_CONTRACT,
    measure: ({ text }) =>
      Promise.resolve({
        tokens: text.length + (nonadditive && text.includes('\n\n') ? 1000 : 0),
        accuracy: estimated ? 'estimated' : 'exact',
      }),
  });
}
it('skips an oversized nearest chunk, considers smaller later hits and counts source/separator costs', async () => {
  const f = await fixture();
  await f.create();
  await f.mutations.run('ingest', {
    memoryId: 'space',
    requestId: 'large',
    content: 'aligned ' + 'L'.repeat(200),
    source: { ref: 's' },
  });
  await f.mutations.run('ingest', {
    memoryId: 'space',
    requestId: 'small',
    content: 'angled small',
    source: { ref: 's' },
  });
  const context = createRetrievalContext(createRetrievalQueries(f.resources), {
    counter: counter(),
  });
  const result = await context.read(
    { memoryId: 'space', query: 'aligned', maxTokens: 40 },
    new AbortController().signal
  );
  expect(result.hits.map((hit) => hit.text)).toEqual(['angled small']);
  expect(result.text).toBe('[1] s\nangled small');
  expect(result.measurement?.tokens).toBe(result.text.length);
  expect(result.citations[0]?.source?.ref).toBe('s');
  expect((await f.backend.inspect('space'))?.sequence).toBe(2);
});
it('measures whole rendered output with a non-additive counter instead of summing chunk counts', async () => {
  const f = await fixture();
  await f.create();
  for (const requestId of ['a', 'b'])
    await f.mutations.run('ingest', {
      memoryId: 'space',
      requestId,
      content: 'aligned',
      source: { ref: requestId },
    });
  const context = createRetrievalContext(createRetrievalQueries(f.resources), {
    counter: counter(true),
  });
  const result = await context.read(
    { memoryId: 'space', query: 'aligned', maxTokens: 100 },
    new AbortController().signal
  );
  expect(result.hits).toHaveLength(1);
  expect(result.measurement?.tokens).toBeLessThanOrEqual(100);
});
it('distinguishes empty from no-chunk-fits and does not require a counter for unbounded reads', async () => {
  const f = await fixture();
  await f.create();
  const queries = createRetrievalQueries(f.resources);
  const signal = new AbortController().signal;
  const unbounded = createRetrievalContext(queries);
  await expect(unbounded.read({ memoryId: 'space', query: 'x' }, signal)).rejects.toMatchObject({
    code: 'TOKEN_COUNTER_REQUIRED',
  });
  expect(
    (await unbounded.read({ memoryId: 'space', query: 'x', maxTokens: null }, signal)).outcome
  ).toBe('empty');
  await f.mutations.run('ingest', {
    memoryId: 'space',
    requestId: 'a',
    content: 'aligned',
    source: { ref: 's' },
  });
  expect(
    (
      await createRetrievalContext(queries, { counter: counter() }).read(
        { memoryId: 'space', query: 'x', maxTokens: 1 },
        signal
      )
    ).outcome
  ).toBe('no-chunk-fits');
  expect(
    (await unbounded.read({ memoryId: 'space', query: 'x', maxTokens: null }, signal)).measurement
  ).toBeNull();
});
it('rejects estimated or mismatched measurements rather than claiming a hard guarantee', async () => {
  const f = await fixture();
  await f.create();
  await f.mutations.run('ingest', { memoryId: 'space', requestId: 'a', content: 'aligned' });
  const queries = createRetrievalQueries(f.resources);
  const signal = new AbortController().signal;
  await expect(
    createRetrievalContext(queries, { counter: counter(false, true) }).read(
      { memoryId: 'space', query: 'aligned' },
      signal
    )
  ).rejects.toMatchObject({ code: 'MEASUREMENT_FAILED' });
  const exact = counter();
  const wrong = {
    ...exact,
    measure: async (...args: Parameters<typeof exact.measure>) => ({
      ...(await exact.measure(...args)),
      measurementRef: 'wrong',
    }),
  };
  await expect(
    createRetrievalContext(queries, { counter: wrong }).read(
      { memoryId: 'space', query: 'aligned' },
      signal
    )
  ).rejects.toMatchObject({ code: 'MEASUREMENT_FAILED' });
});
it('preserves identical text from separate sources and supports a custom renderer with actual budget validation', async () => {
  const f = await fixture();
  await f.create();
  for (const requestId of ['a', 'b'])
    await f.mutations.run('ingest', {
      memoryId: 'space',
      requestId,
      content: 'aligned',
      source: { ref: requestId },
    });
  const resources = createRetrievalWorkflowResources(f.resources, {
    context: {
      counter: counter(),
      defaultRendererRef: 'custom:v1',
      renderers: {
        resolve: () => ({
          ref: 'custom:v1',
          render: ({ hits, separator }) => hits.map((hit) => hit.text).join(separator),
        }),
      },
    },
  });
  const w = createRetrievalMemoryBundle({ resources }).workflows;
  const result = await w.readContext.run({
    input: { memoryId: 'space', query: 'aligned', separator: '|', maxTokens: 20 },
  });
  if (result.status !== 'completed') throw new Error('Unexpected skip');
  expect(result.value.text).toBe('aligned|aligned');
  expect(result.value.citations.map((citation) => citation.source?.ref).sort()).toEqual(['a', 'b']);
});
it('finalizes custom selection through the same budget and provenance guard', async () => {
  const f = await fixture();
  await f.create();
  await f.mutations.run('ingest', { memoryId: 'space', requestId: 'a', content: 'aligned' });
  const resources = createRetrievalWorkflowResources(f.resources, {
    context: { counter: counter() },
  });
  const definition = createRetrievalReadContextDefinition({
    stepOverrides: {
      select: (context) => {
        context.state.selected = context.state.candidate!.result.hits;
        return Promise.resolve();
      },
    },
  });
  const w = createRetrievalMemoryBundle({
    resources,
    workflows: { readContext: definition },
  }).workflows;
  await expect(
    w.readContext.run({ input: { memoryId: 'space', query: 'aligned', maxTokens: 1 } })
  ).rejects.toMatchObject({ code: 'CONTEXT_BUDGET_EXCEEDED' });
  const operations = resources.context;
  const signal = new AbortController().signal;
  const candidate = await operations.search(
    { memoryId: 'space', query: 'aligned', maxTokens: null },
    signal
  );
  await expect(
    operations.finalize(
      candidate,
      candidate.result.hits.map((hit) => ({ ...hit, source: { ref: 'forged' } })),
      signal
    )
  ).rejects.toMatchObject({ code: 'SEARCH_FAILED' });
});
