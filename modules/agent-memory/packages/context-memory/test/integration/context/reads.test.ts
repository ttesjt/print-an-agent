import { expect, it } from 'vitest';
import { ContextMemoryError, MemoryMeter, readMemoryContext } from '@print-an-agent/context-memory';
import { testCounter } from '../../support/counter.js';
import { createMemoryFixture as fixture } from '../../support/memory.js';

it('recounts alternate tokenizers, returns full report, and rejects unrecognized render overrides', async () => {
  const { store, mutations } = fixture();
  await mutations.create({
    memoryId: 'a',
    requestId: 'create',
    items: [{ content: 'hello' }],
    config: { maxContextTokens: 10 },
  });
  const meter = new MemoryMeter({
    counter: testCounter('other', (text) => Promise.resolve(text.length * 10)),
  });
  await expect(
    readMemoryContext({ store, meter }, { memoryId: 'a', measurementRef: 'other' })
  ).rejects.toMatchObject({ code: 'BUDGET_EXCEEDED' });
  const report = await readMemoryContext(
    { store, meter },
    { memoryId: 'a', measurementRef: 'other', budgetPolicy: 'report' }
  );
  expect(report.text).toBe('hello');
  expect(report.budget.status).toBe('exceeded');
  expect(report.snapshot.revision).toBe(1);
  expect(report.measurement.measurementRef).toBe('other');
  const invalid = { memoryId: 'a', render: { format: 'json' } };
  await expect(readMemoryContext({ store, meter }, invalid)).rejects.toBeInstanceOf(
    ContextMemoryError
  );
  expect((await store.read('a'))?.config.measurementRef).toBe('characters');
});
