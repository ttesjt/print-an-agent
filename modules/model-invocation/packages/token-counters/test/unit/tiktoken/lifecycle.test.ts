import { beforeEach, expect, it, vi } from 'vitest';

// Observe real SDK/rank imports and construction; measurement still uses the actual vocabulary.
const state = vi.hoisted(() => ({ lite: 0, cl100k: 0, o200k: 0, instances: 0, fail: false }));
function instrumentSdk(): void {
  vi.doMock('js-tiktoken/lite', async (importOriginal) => {
    state.lite++;
    if (state.fail) throw new Error('fixture vocabulary initialization failed');
    const actual = await importOriginal<typeof import('js-tiktoken/lite')>();
    return {
      ...actual,
      Tiktoken: class extends actual.Tiktoken {
        constructor(...args: ConstructorParameters<typeof actual.Tiktoken>) {
          super(...args);
          state.instances++;
        }
      },
    };
  });
  vi.doMock('js-tiktoken/ranks/cl100k_base', async (importOriginal) => {
    state.cl100k++;
    return importOriginal<typeof import('js-tiktoken/ranks/cl100k_base')>();
  });
  vi.doMock('js-tiktoken/ranks/o200k_base', async (importOriginal) => {
    state.o200k++;
    return importOriginal<typeof import('js-tiktoken/ranks/o200k_base')>();
  });
}
beforeEach(() => {
  vi.resetModules();
  Object.assign(state, { lite: 0, cl100k: 0, o200k: 0, instances: 0, fail: false });
  instrumentSdk();
});
const input = { kind: 'text', text: 'hello world' } as const;
const signal = () => new AbortController().signal;

it.each(['cl100k_base', 'o200k_base'] as const)(
  'loads only %s on measurement and shares initialization within one instance',
  async (encoding) => {
    const api = await import('../../../src/index.js');
    api.defineTextTokenCounterConfig({ kind: 'tiktoken', encoding });
    const first = api.createTiktokenTextCounter({ encoding });
    const second = api.createTiktokenTextCounter({ encoding });
    expect(state).toEqual({ lite: 0, cl100k: 0, o200k: 0, instances: 0, fail: false });
    const [a, b] = await Promise.all([
      first.measure(input, signal()),
      first.measure(input, signal()),
    ]);
    expect(a.tokens).toBe(2);
    expect(b.tokens).toBe(2);
    expect(state.instances).toBe(1);
    expect(state.lite).toBe(1);
    expect(state.cl100k).toBe(encoding === 'cl100k_base' ? 1 : 0);
    expect(state.o200k).toBe(encoding === 'o200k_base' ? 1 : 0);
    await second.measure(input, signal());
    expect(state.instances).toBe(2);
    expect(state.lite).toBe(1);
  }
);

it('does not initialize for a pre-cancelled measurement', async () => {
  const { createTiktokenTextCounter } = await import('../../../src/index.js');
  const counter = createTiktokenTextCounter({ encoding: 'cl100k_base' });
  const controller = new AbortController();
  const cause = new Error('caller stopped');
  controller.abort(cause);
  await expect(counter.measure(input, controller.signal)).rejects.toBe(cause);
  expect(state.lite).toBe(0);
  expect(state.instances).toBe(0);
});

it('retains the failed initialization outcome within the instance without fallback', async () => {
  state.fail = true;
  const { createTiktokenTextCounter } = await import('../../../src/index.js');
  const counter = createTiktokenTextCounter({ encoding: 'cl100k_base' });
  let originalCause: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    let failure: unknown;
    try {
      await counter.measure(input, signal());
    } catch (cause: unknown) {
      failure = cause;
    }
    expect(failure).toMatchObject({ code: 'TOKEN_MEASUREMENT_FAILED' });
    if (!(failure instanceof Error)) throw new Error('Expected measurement failure');
    if (attempt === 0) originalCause = failure.cause;
    else expect(failure.cause).toBe(originalCause);
  }
  expect(state.lite).toBe(1);
  expect(state.instances).toBe(0);
  expect(state.cl100k + state.o200k).toBe(0);
});
