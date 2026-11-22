import { MemoryMeter, MemoryMutations } from '@print-an-agent/context-memory';
import { TestMemoryStore } from './store.js';
import { testCounter } from './counter.js';

export function createMemoryFixture(): {
  store: TestMemoryStore;
  meter: MemoryMeter;
  mutations: MemoryMutations;
} {
  const store = new TestMemoryStore();
  const meter = new MemoryMeter({ counter: testCounter('characters') });
  let next = 0;
  const mutations = new MemoryMutations({
    store,
    meter,
    defaults: { measurementRef: 'characters' },
    createItemId: () => `item-${++next}`,
  });
  return { store, meter, mutations };
}
