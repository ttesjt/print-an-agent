import { describe, expect, it } from 'vitest';
import { MemoryMeter, MemoryMutations, type MemoryStore } from '@print-an-agent/context-memory';
import { testCounter } from './counter.js';

/** Adapter-neutral assertions; setup owns per-test cleanup and supplies a fresh store. */
export function memoryStoreContract(name: string, setup: () => MemoryStore): void {
  describe(`${name}: public MemoryStore contract`, () => {
    const fixture = () => {
      const store = setup();
      const meter = new MemoryMeter({ counter: testCounter() });
      const mutations = new MemoryMutations({
        store,
        meter,
        defaults: { measurementRef: 'chars' },
      });
      return { store, mutations };
    };
    it('returns isolated values and persists configure at a single new revision', async () => {
      const { store, mutations } = fixture();
      await mutations.create({ memoryId: 'a', requestId: 'create', items: [{ content: 'one' }] });
      const snapshot = await store.read('a');
      if (snapshot === undefined) throw new Error('Missing created snapshot.');
      // Mutating a returned object must not mutate persisted authority.
      Reflect.set(snapshot.config, 'maxContextTokens', 1);
      expect((await store.read('a'))?.config.maxContextTokens).toBe(4096);
      await mutations.configure({
        memoryId: 'a',
        requestId: 'configure',
        expectedRevision: 1,
        config: { render: { format: 'json' } },
      });
      expect((await store.read('a'))?.config.render).toEqual({ format: 'json' });
      expect(await store.getReceipt('a', 'configure')).toMatchObject({
        revision: 2,
        previousRevision: 1,
        changes: { addedItemIds: [], updatedItemIds: [], removedItemIds: [] },
      });
    });
    it('rejects a stale no-op without issuing a receipt', async () => {
      const { store, mutations } = fixture();
      await mutations.create({ memoryId: 'a', requestId: 'create' });
      await mutations.apply({
        memoryId: 'a',
        requestId: 'add',
        expectedRevision: 1,
        commands: [{ op: 'add', content: 'new' }],
      });
      await expect(
        mutations.apply({
          memoryId: 'a',
          requestId: 'stale',
          expectedRevision: 1,
          commands: [],
        })
      ).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
      expect(await store.getReceipt('a', 'stale')).toBeUndefined();
    });
    it('never implicitly creates documents on apply or cancelled create', async () => {
      const { store, mutations } = fixture();
      await expect(
        mutations.apply({
          memoryId: 'missing',
          requestId: 'edit',
          expectedRevision: 1,
          commands: [],
        })
      ).rejects.toMatchObject({ code: 'MEMORY_NOT_FOUND' });
      const controller = new AbortController();
      controller.abort();
      await expect(
        mutations.create({ memoryId: 'missing', requestId: 'create' }, controller.signal)
      ).rejects.toMatchObject({ code: 'OPERATION_ABORTED', commit: { status: 'not-committed' } });
      expect(await store.read('missing')).toBeUndefined();
      expect(await store.getReceipt('missing', 'create')).toBeUndefined();
    });
    it('rejects an oversized configure without altering content, config or revision', async () => {
      const { store, mutations } = fixture();
      await mutations.create({ memoryId: 'a', requestId: 'create', items: [{ content: 'word' }] });
      const before = await store.read('a');
      await expect(
        mutations.configure({
          memoryId: 'a',
          requestId: 'smaller',
          expectedRevision: 1,
          config: { maxContextTokens: 1 },
        })
      ).rejects.toMatchObject({ code: 'BUDGET_EXCEEDED' });
      expect(await store.read('a')).toEqual(before);
      expect(await store.getReceipt('a', 'smaller')).toBeUndefined();
    });
  });
}
