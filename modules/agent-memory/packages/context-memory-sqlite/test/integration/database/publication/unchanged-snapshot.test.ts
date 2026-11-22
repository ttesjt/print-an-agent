import { expect, it } from 'vitest';

import { borrowed } from '../../../support/fixtures.js';

it('does not replace a logical snapshot with refreshed measurement on unchanged commit', async () => {
  const { store, mutations } = borrowed();
  await mutations.create({ memoryId: 'm', requestId: 'c' });
  const before = (await store.read('m'))!;
  const result = await store.commit({
    request: { memoryId: 'm', requestId: 'cache', operation: 'apply', input: {} },
    expectedRevision: 1,
    state: {
      config: before.config,
      items: before.items,
      measurement: { ...before.measurement, tokens: before.measurement.tokens + 1 },
    },
    commandOutcomes: [],
  });
  expect(result.status).toBe('unchanged');
  expect(await store.read('m')).toEqual(before);
});
