import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import type { RetrievalMemoryPort } from '../../src/memory/contracts.js';
import { memoryOptions } from '../support/memory.js';
import { memoryUiHost } from '../support/memory-ui-host.js';
import { button, click, edit, field, mountMemory, until } from '../support/memory-ui.js';

const env = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
beforeAll(() => {
  env.IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => {
  delete env.IS_REACT_ACT_ENVIRONMENT;
});
const target = { agentId: 'a', memoryId: 'main' };

it.each([
  { recovery: 'receipt', displayFailure: false },
  { recovery: 'receipt', displayFailure: true },
  { recovery: 'replay', displayFailure: false },
  { recovery: 'replay', displayFailure: true },
] as const)(
  'finalizes ingest after $recovery recovery, including display failure=$displayFailure',
  async ({ recovery, displayFailure }) => {
    const { memory } = await memoryUiHost();
    const original = memory.retrieval!;
    await original.create({ ...target, requestId: 'create', index: memoryOptions().index });
    let firstAttempt = true;
    let failReads = false;
    let publications = 0;
    const ingest = vi.fn<RetrievalMemoryPort['ingest']>(async (input) => {
      if (firstAttempt) {
        firstAttempt = false;
        if (recovery === 'receipt') {
          await original.ingest(input);
          publications++;
        }
        return {
          status: 'indeterminate',
          notice: { code: 'delivery-lost', message: 'Delivery unconfirmed' },
          recovery: { ...target, requestId: input.requestId },
        };
      }
      const result = await original.ingest(input);
      publications++;
      if (recovery === 'replay' && publications === 1) failReads = displayFailure;
      return result;
    });
    const port: RetrievalMemoryPort = {
      ...original,
      ingest,
      inspect: (input) =>
        failReads
          ? Promise.reject(new Error('Space display unavailable'))
          : original.inspect(input),
      list: (input) =>
        failReads ? Promise.reject(new Error('Entry display unavailable')) : original.list(input),
      getReceipt: async (input) => {
        const result = await original.getReceipt(input);
        if (recovery === 'receipt' && result.status === 'succeeded' && result.value !== null)
          failReads = displayFailure;
        return result;
      },
    };
    mountMemory({ ...memory, retrieval: port });
    click('Memory');
    edit('Memory binding', '1');
    await until(() => document.body.textContent?.includes('No entries yet') === true);
    edit('New Entry', 'first cat note');
    click('Add Entry');
    await until(() => document.body.textContent?.includes('Delivery unconfirmed') === true);
    expect(button('Add Entry').disabled).toBe(true);
    click('Read receipt');
    if (recovery === 'replay') {
      await until(() => document.body.textContent?.includes('Retry original request') === true);
      click('Retry original request');
    }
    await until(() => document.body.textContent?.includes('Committed.') === true);
    expect(field('New Entry').value).toBe('');
    expect(button('Add Entry').disabled).toBe(true);
    expect(document.querySelector('[data-testid="memory-boundary"]')?.textContent).toBe('clean');
    const list = document.querySelector('[aria-label="Memory entries"]')!;
    if (displayFailure) {
      await until(() => document.body.textContent?.includes('Entry display unavailable') === true);
      failReads = false;
      click('Read current state');
    }
    await until(() => list.querySelectorAll('dl > div').length === 1);
    const expectedAttempts = recovery === 'receipt' ? 1 : 2;
    expect(ingest).toHaveBeenCalledTimes(expectedAttempts);
    expect(publications).toBe(1);
    if (recovery === 'replay') {
      expect(ingest.mock.calls[0]?.[0].requestId).toBe(ingest.mock.calls[1]?.[0].requestId);
      expect(ingest.mock.calls[0]?.[0].content).toBe(ingest.mock.calls[1]?.[0].content);
    }
    click('Add Entry');
    expect(ingest).toHaveBeenCalledTimes(expectedAttempts);
    const current = await original.list(target);
    if (current.status !== 'succeeded') throw new Error('Missing authoritative list');
    expect(current.value.entries).toHaveLength(1);

    // A later draft belongs to a new edit, not to the recovered request's completion.
    edit('New Entry', 'second dog note');
    click('Refresh entries');
    await until(() => !button('Refresh entries').disabled);
    expect(field('New Entry').value).toBe('second dog note');
    click('Add Entry');
    await until(
      () => list.querySelectorAll('dl > div').length === 2 && field('New Entry').value === ''
    );
    expect(publications).toBe(2);
    expect(ingest.mock.calls.at(-1)?.[0].requestId).not.toBe(ingest.mock.calls[0]?.[0].requestId);
  }
);
