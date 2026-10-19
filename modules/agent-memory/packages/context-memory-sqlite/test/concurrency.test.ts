import { expect, it } from 'vitest';
import { testCounter } from './support/counter.js';
import { domain, fileStores, gate } from './support/fixtures.js';

function synchronize() {
  const ready = gate();
  const release = gate();
  let arrived = 0;
  const counter = testCounter(async (text) => {
    if (++arrived === 2) ready.release();
    await release.promise;
    return text.length;
  });
  return { counter, ready, release };
}
it('two connections preparing the same revision cannot overwrite each other', async () => {
  const { first, second } = await fileStores();
  await domain(first).mutations.create({ memoryId: 'a', requestId: 'create' });
  const sync = synchronize();
  const a = domain(first, sync.counter, () => 'first').mutations.apply({
    memoryId: 'a',
    requestId: 'first',
    expectedRevision: 1,
    commands: [{ op: 'add', content: 'one' }],
  });
  const b = domain(second, sync.counter, () => 'second').mutations.apply({
    memoryId: 'a',
    requestId: 'second',
    expectedRevision: 1,
    commands: [{ op: 'add', content: 'two' }],
  });
  await sync.ready.promise;
  sync.release.release();
  const results = await Promise.allSettled([a, b]);
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  expect(results.find((result) => result.status === 'rejected')).toMatchObject({
    status: 'rejected',
    reason: { code: 'REVISION_CONFLICT', commit: { status: 'not-committed' } },
  });
  const snapshot = await first.read('a');
  expect(snapshot?.revision).toBe(2);
  expect(snapshot?.items).toHaveLength(1);
});
it('concurrent same-request creation returns the same real system IDs despite different candidates', async () => {
  const { first, second } = await fileStores();
  const sync = synchronize();
  const input = { memoryId: 'a', requestId: 'shared', items: [{ content: 'same' }] };
  const a = domain(first, sync.counter, () => 'id-a').mutations.create(input);
  const b = domain(second, sync.counter, () => 'id-b').mutations.create(input);
  await sync.ready.promise;
  sync.release.release();
  const [one, two] = await Promise.all([a, b]);
  expect(one).toEqual(two);
  expect((await second.read('a'))?.revision).toBe(1);
  expect((await second.read('a'))?.items).toHaveLength(1);
});
it('concurrent distinct requests cannot create the same identity twice', async () => {
  const { first, second } = await fileStores();
  const sync = synchronize();
  const a = domain(first, sync.counter).mutations.create({
    memoryId: 'a',
    requestId: 'one',
    items: [{ content: 'one' }],
  });
  const b = domain(second, sync.counter).mutations.create({
    memoryId: 'a',
    requestId: 'two',
    items: [{ content: 'two' }],
  });
  await sync.ready.promise;
  sync.release.release();
  const results = await Promise.allSettled([a, b]);
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  expect(results.find((result) => result.status === 'rejected')).toMatchObject({
    reason: { code: 'MEMORY_ALREADY_EXISTS' },
  });
});
it('concurrent same identity but different business input returns request conflict, not CAS conflict', async () => {
  const { first, second } = await fileStores();
  const sync = synchronize();
  const a = domain(first, sync.counter).mutations.create({
    memoryId: 'a',
    requestId: 'same',
    items: [{ content: 'one' }],
  });
  const b = domain(second, sync.counter).mutations.create({
    memoryId: 'a',
    requestId: 'same',
    items: [{ content: 'two' }],
  });
  await sync.ready.promise;
  sync.release.release();
  const results = await Promise.allSettled([a, b]);
  expect(results.find((result) => result.status === 'rejected')).toMatchObject({
    reason: { code: 'REQUEST_CONFLICT' },
  });
});
