import { act } from 'react';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { memoryOptions } from '../support/memory.js';
import { memoryUiHost as memoryHost } from '../support/memory-ui-host.js';
import { button, click, edit, field, mountMemory, until } from '../support/memory-ui.js';
import type { ContextMemoryPort } from '../../src/memory/contracts.js';
import type { RetrievalMemoryPort } from '../../src/memory/contracts.js';
import { DEFAULT_AGENT_CONFIG } from '../../src/application/agent-config.js';

const env = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
beforeAll(() => {
  env.IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => {
  delete env.IS_REACT_ACT_ENVIRONMENT;
});
const target = { agentId: 'a', memoryId: 'main' };

it('hides disabled capabilities and never creates on read; exposes Context and Retrieval independently', async () => {
  const view = mountMemory(undefined);
  expect(document.body.textContent).not.toContain('Memory');
  const f = memoryOptions();
  const { memory } = await memoryHost({
    ...f.options,
    provisioning: { storageNamespaceId: 'context-only', context: f.options.provisioning.context! },
  });
  view.render('a', memory);
  click('Memory');
  await until(() => document.body.textContent?.includes('not been created') === true);
  expect(field('Memory binding').textContent).not.toContain('Retrieval');
  expect(await memory.context!.inspect(target)).toMatchObject({
    status: 'failed',
    failure: { domainCode: 'MEMORY_NOT_FOUND' },
  });
  expect(f.embed).not.toHaveBeenCalled();
});

it('creates/edits Context items, keeps CAS conflict draft, independently renders preview and configures budget', async () => {
  const { memory } = await memoryHost();
  mountMemory(memory);
  click('Memory');
  await until(() => document.body.textContent?.includes('not been created') === true);
  click('Create Context Memory');
  await until(() => document.body.textContent?.includes('Revision 1') === true);
  click('Add item');
  edit('Memory item 1', 'Remember cats');
  click('Save Memory');
  await until(() => document.body.textContent?.includes('Revision 2') === true);
  expect(field('Memory item 1').value).toBe('Remember cats');
  edit('Memory item 1', 'My draft');
  await act(async () => {
    await memory.context!.apply({
      ...target,
      requestId: 'external',
      expectedRevision: 2,
      commands: [{ op: 'add', content: 'External change' }],
    });
  });
  click('Save Memory');
  await until(() => document.body.textContent?.includes('REVISION_CONFLICT') === true);
  expect(field('Memory item 1').value).toBe('My draft');
  click('Close Memory');
  expect(document.body.textContent).toContain('Discard Memory edits?');
  click('Keep editing');
  click('Discard and reload Memory');
  await until(() => document.body.textContent?.includes('Revision 3') === true);
  expect(field('Memory item 1').value).toBe('Remember cats');
  edit('Token budget (blank = unlimited)', '5');
  click('Save Memory');
  await until(() => document.body.textContent?.includes('BUDGET_EXCEEDED') === true);
  expect(field('Token budget (blank = unlimited)').value).toBe('5');
});

it('preserves commit and unlocks after display failure; receipt recovery never repeats a write', async () => {
  const { memory } = await memoryHost();
  await memory.context!.create({ ...target, requestId: 'create' });
  let failRead = false;
  const original = memory.context!;
  const apply = vi.fn<ContextMemoryPort['apply']>(async (input) => {
    await original.apply(input);
    failRead = true;
    return {
      status: 'indeterminate',
      notice: { code: 'lost', message: 'Delivery lost' },
      recovery: { ...target, requestId: input.requestId },
    };
  });
  const port: ContextMemoryPort = {
    ...original,
    apply,
    inspect: async (input) => {
      if (failRead) throw new Error('Display unavailable');
      return original.inspect(input);
    },
    readContext: () => Promise.reject(new Error('Preview unavailable')),
  };
  mountMemory({ ...memory, context: port });
  click('Memory');
  await until(() => document.body.textContent?.includes('Revision 1') === true);
  expect(document.body.textContent).toContain('Preview unavailable');
  click('Add item');
  edit('Memory item 1', 'Committed cat');
  click('Save Memory');
  await until(() => document.body.textContent?.includes('Delivery lost') === true);
  expect(button('Save Memory').disabled).toBe(true);
  click('Read receipt');
  await until(() => document.body.textContent?.includes('Commit confirmed') === true);
  expect(apply).toHaveBeenCalledTimes(1);
  expect(document.querySelector('[data-testid="memory-boundary"]')?.textContent).not.toBe(
    'working'
  );
  click('Discard and reload Memory');
  await until(() => document.body.textContent?.includes('could not be loaded') === true);
  failRead = false;
  click('Discard and reload Memory');
  await until(() => document.body.textContent?.includes('Revision 2') === true);
  expect(apply).toHaveBeenCalledTimes(1);
});

it('ignores old Agent read results and isolates multiple bindings', async () => {
  const f = memoryOptions();
  const { memory, backend } = await memoryHost({
    ...f.options,
    contextBindings: [
      { memoryId: 'one', label: 'One' },
      { memoryId: 'two', label: 'Two' },
    ],
  });
  await backend.agents.createAgent({
    identity: { agentId: 'b', displayName: 'B' },
    config: DEFAULT_AGENT_CONFIG,
  });
  let release: (() => void) | undefined;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  const original = memory.context!;
  const delayed: ContextMemoryPort = {
    ...original,
    inspect: async (input) => {
      if (input.agentId === 'a') await wait;
      return original.inspect(input);
    },
  };
  const view = mountMemory({ ...memory, context: delayed });
  click('Memory');
  view.render('b', { ...memory, context: delayed });
  click('Memory');
  await until(
    () =>
      document.body.textContent?.includes('Agent b') === true &&
      document.body.textContent.includes('not been created')
  );
  click('Create Context Memory');
  await until(() => document.body.textContent?.includes('Revision 1') === true);
  act(() => {
    release?.();
  });
  expect(document.body.textContent).toContain('Agent b');
  edit('Memory binding', '1');
  await until(() => document.body.textContent?.includes('not been created') === true);
  expect(await original.inspect({ agentId: 'a', memoryId: 'one' })).toMatchObject({
    status: 'failed',
    failure: { domainCode: 'MEMORY_NOT_FOUND' },
  });
  expect(await original.inspect({ agentId: 'b', memoryId: 'one' })).toMatchObject({
    value: { revision: 1 },
  });
});

it('paginates actual Retrieval entries, searches, edits metadata/source, reindexes and confirms deletion', async () => {
  const f = memoryOptions();
  const { memory } = await memoryHost(f.options);
  const port = memory.retrieval!;
  await port.create({ ...target, requestId: 'create', index: f.index });
  for (let i = 0; i < 23; i++)
    await port.ingest({ ...target, requestId: `item-${i}`, content: `cat ${i}` });
  mountMemory(memory);
  click('Memory');
  edit('Memory binding', '1');
  await until(() => document.body.textContent?.includes('Load more entries') === true);
  const list = document.querySelector('[aria-label="Memory entries"]')!;
  expect(list.querySelectorAll('dl > div')).toHaveLength(20);
  click('Load more entries');
  await until(() => list.querySelectorAll('dl > div').length === 23);
  edit('Search Memory', 'cat');
  click('Search');
  await until(() => document.body.textContent?.includes('Search results') === true);
  const entryButton = list.querySelector<HTMLButtonElement>('button')!;
  act(() => entryButton.click());
  await until(() => document.body.textContent?.includes('Entry content') === true);
  edit('Entry content', 'dog revised');
  edit('Entry metadata (JSON)', '{"kind":"pet"}');
  edit('Entry source (JSON)', '{"ref":"manual","label":"Edited"}');
  click('Save Entry');
  await until(() => document.body.textContent?.includes('Entry revision 2') === true);
  click('Reindex Entry');
  await until(() => !button('Reindex Entry').disabled);
  click('Delete Entry…');
  click('Keep Entry');
  expect(document.body.textContent).toContain('Entry content');
  click('Delete Entry…');
  click('Delete Entry');
  await until(() => document.body.textContent?.includes('Entry content') === false);
});

it('browses and deletes with no advertised embedding; unavailable model work does not hide content', async () => {
  const f = memoryOptions();
  const { memory } = await memoryHost(f.options);
  await memory.retrieval!.create({ ...target, requestId: 'create', index: f.index });
  await memory.retrieval!.ingest({ ...target, requestId: 'ingest', content: 'cat' });
  f.embed.mockClear();
  const limited = {
    ...memory,
    capabilities: {
      retrieval: { bindings: [{ memoryId: 'main', label: 'Knowledge' }], embeddings: [] },
    },
    context: undefined,
  };
  mountMemory({ capabilities: limited.capabilities, retrieval: limited.retrieval! });
  click('Memory');
  await until(() => document.querySelector('[aria-label="Memory entries"] dl button') !== null);
  expect(button('Add Entry').disabled).toBe(true);
  act(() =>
    document.querySelector<HTMLButtonElement>('[aria-label="Memory entries"] dl button')!.click()
  );
  await until(() => document.body.textContent?.includes('Entry content') === true);
  expect(field('Entry content').value).toBe('cat');
  click('Delete Entry…');
  click('Delete Entry');
  await until(() => document.body.textContent?.includes('No entries yet') === true);
  expect(f.embed).not.toHaveBeenCalled();
});

it('does not dismiss an in-flight write; cancellation racing a commit preserves that receipt', async () => {
  const { memory } = await memoryHost();
  const context = memory.context!;
  await context.create({ ...target, requestId: 'create' });
  let complete: (() => void) | undefined;
  const wait = new Promise<void>((resolve) => {
    complete = resolve;
  });
  let signal: AbortSignal | undefined;
  const port: ContextMemoryPort = {
    ...context,
    apply: async (input) => {
      signal = input.signal;
      await wait;
      return context.apply({
        ...target,
        requestId: input.requestId,
        expectedRevision: input.expectedRevision,
        commands: input.commands,
      });
    },
  };
  mountMemory({ ...memory, context: port });
  click('Memory');
  await until(() => document.body.textContent?.includes('Revision 1') === true);
  click('Add item');
  edit('Memory item 1', 'late commit');
  click('Save Memory');
  await until(() => signal !== undefined);
  expect(button('Close Memory').disabled).toBe(true);
  expect(field('Memory binding').disabled).toBe(true);
  const dialog = document.querySelector<HTMLDialogElement>('dialog[open]')!;
  act(() => {
    dialog.dispatchEvent(new Event('cancel', { cancelable: true }));
  });
  expect(dialog.open).toBe(true);
  click('Cancel Memory operation');
  expect(signal?.aborted).toBe(true);
  act(() => {
    complete?.();
  });
  await until(() => document.body.textContent?.includes('Revision 2') === true);
  expect(document.body.textContent).toContain('Committed.');
});

it('reports missing Agent separately from an uncreated Memory', async () => {
  const { memory } = await memoryHost();
  mountMemory(memory, 'missing');
  click('Memory');
  await until(() => document.body.textContent?.includes('MEMORY_AGENT_NOT_FOUND') === true);
  expect(document.body.textContent).not.toContain('Create Context Memory');
});

it('preserves a recovered receipt when cancellation races receipt delivery', async () => {
  const { memory } = await memoryHost();
  const context = memory.context!;
  await context.create({ ...target, requestId: 'create' });
  let release: (() => void) | undefined;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  let readReceipt = false;
  const apply = vi.fn<ContextMemoryPort['apply']>(async (input) => {
    await context.apply(input);
    return {
      status: 'indeterminate',
      notice: { code: 'lost', message: 'Lost delivery' },
      recovery: { ...target, requestId: input.requestId },
    };
  });
  const port: ContextMemoryPort = {
    ...context,
    apply,
    getReceipt: async (input) => {
      const result = await context.getReceipt(input);
      readReceipt = true;
      await wait;
      return result;
    },
  };
  mountMemory({ ...memory, context: port });
  click('Memory');
  await until(() => document.body.textContent?.includes('Revision 1') === true);
  click('Add item');
  edit('Memory item 1', 'durable note');
  click('Save Memory');
  await until(() => document.body.textContent?.includes('Lost delivery') === true);
  click('Read receipt');
  await until(() => readReceipt);
  click('Cancel Memory operation');
  act(() => {
    release?.();
  });
  await until(
    () =>
      document.body.textContent?.includes('Commit confirmed') === true &&
      document.body.textContent.includes('Revision 2')
  );
  expect(apply).toHaveBeenCalledTimes(1);
  expect(document.querySelector('[data-testid="memory-boundary"]')?.textContent).toBe('clean');
});

it('only retries an unconfirmed write with the identical original request and then permits new edits', async () => {
  const { memory } = await memoryHost();
  const context = memory.context!;
  await context.create({ ...target, requestId: 'create' });
  let firstAttempt = true;
  const apply = vi.fn<ContextMemoryPort['apply']>((input) => {
    if (firstAttempt) {
      firstAttempt = false;
      return Promise.resolve({
        status: 'indeterminate',
        notice: { code: 'lost', message: 'Not delivered' },
        recovery: { ...target, requestId: input.requestId },
      });
    }
    return context.apply(input);
  });
  mountMemory({ ...memory, context: { ...context, apply } });
  click('Memory');
  await until(() => document.body.textContent?.includes('Revision 1') === true);
  click('Add item');
  edit('Memory item 1', 'original');
  click('Save Memory');
  await until(() => document.body.textContent?.includes('Not delivered') === true);
  click('Read receipt');
  await until(() => document.body.textContent?.includes('Retry original request') === true);
  click('Retry original request');
  await until(() => document.body.textContent?.includes('Revision 2') === true);
  expect(apply.mock.calls[0]?.[0].requestId).toBe(apply.mock.calls[1]?.[0].requestId);
  expect(apply.mock.calls[0]?.[0].commands).toEqual(apply.mock.calls[1]?.[0].commands);
  edit('Memory item 1', 'new edit');
  click('Save Memory');
  await until(() => document.body.textContent?.includes('Revision 3') === true);
  expect(apply.mock.calls[2]?.[0].requestId).not.toBe(apply.mock.calls[0]?.[0].requestId);
});

it('requires a current Context snapshot after a known commit whose display read failed, preventing duplicate adds', async () => {
  const { memory } = await memoryHost();
  const context = memory.context!;
  await context.create({ ...target, requestId: 'create' });
  let unavailable = false;
  const apply = vi.fn<ContextMemoryPort['apply']>(async (input) => {
    const result = await context.apply(input);
    unavailable = true;
    return result;
  });
  const port: ContextMemoryPort = {
    ...context,
    apply,
    inspect: (input) =>
      unavailable ? Promise.reject(new Error('Display unavailable')) : context.inspect(input),
  };
  mountMemory({ ...memory, context: port });
  click('Memory');
  await until(() => document.body.textContent?.includes('Revision 1') === true);
  click('Add item');
  edit('Memory item 1', 'first');
  click('Save Memory');
  await until(
    () => document.body.textContent?.includes('last displayed snapshot is stale') === true
  );
  expect(button('Add item').disabled).toBe(true);
  expect(button('Save Memory').disabled).toBe(true);
  unavailable = false;
  click('Discard and reload Memory');
  await until(() => document.body.textContent?.includes('Revision 2') === true);
  edit('Memory item 1', 'second');
  click('Save Memory');
  await until(
    () => document.body.textContent?.includes('last displayed snapshot is stale') === true
  );
  const snapshot = await context.inspect(target);
  expect(snapshot).toMatchObject({ value: { revision: 3, items: [{ content: 'second' }] } });
  if (snapshot.status !== 'succeeded') throw new Error('Missing Memory');
  expect(snapshot.value?.items).toHaveLength(1);
});

it.each(['context', 'retrieval'] as const)(
  'does not offer %s creation again after a committed create and failed display read',
  async (kind) => {
    const { memory } = await memoryHost();
    let unavailable = false;
    const context = memory.context!;
    const retrieval = memory.retrieval!;
    const createContext = vi.fn<ContextMemoryPort['create']>(async (input) => {
      const result = await context.create(input);
      unavailable = true;
      return result;
    });
    const createRetrieval = vi.fn<RetrievalMemoryPort['create']>(async (input) => {
      const result = await retrieval.create(input);
      unavailable = true;
      return result;
    });
    mountMemory({
      ...memory,
      context: {
        ...context,
        create: createContext,
        inspect: (input) =>
          unavailable ? Promise.reject(new Error('Display unavailable')) : context.inspect(input),
      },
      retrieval: {
        ...retrieval,
        create: createRetrieval,
        inspect: (input) =>
          unavailable ? Promise.reject(new Error('Display unavailable')) : retrieval.inspect(input),
      },
    });
    click('Memory');
    if (kind === 'retrieval') edit('Memory binding', '1');
    await until(() => document.body.textContent?.includes('not been created') === true);
    const label = kind === 'context' ? 'Create Context Memory' : 'Create Retrieval Memory';
    click(label);
    await until(() => document.body.textContent?.includes('Display unavailable') === true);
    expect(button(label).disabled).toBe(true);
    unavailable = false;
    click('Read current state');
    await until(
      () =>
        document.body.textContent?.includes(
          kind === 'context' ? 'Revision 1' : 'Space revision 1'
        ) === true
    );
    expect(kind === 'context' ? createContext : createRetrieval).toHaveBeenCalledTimes(1);
  }
);
