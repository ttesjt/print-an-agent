import { getEventListeners } from 'node:events';
import { expect, it } from 'vitest';
// Exercise the emitted feature entry so the native Worker resolves its real JavaScript asset.
import { createWorkerClient } from '../../../dist/worker/index.js';

it('disposes cancellation listeners after success, native failure and dispatch failure', async () => {
  const client = await createWorkerClient({ path: ':memory:', busyTimeoutMs: 0 });
  const { signal } = new AbortController();
  try {
    expect(await client.call('inspect', ['absent'], signal)).toBeUndefined();
    expect(getEventListeners(signal, 'abort')).toHaveLength(0);
    await expect(
      client.call('list', [{ memoryId: 'absent', limit: 1 }], signal)
    ).rejects.toMatchObject({ code: 'MEMORY_NOT_FOUND' });
    expect(getEventListeners(signal, 'abort')).toHaveLength(0);
    const input = { memoryId: 'absent', limit: 1, uncloneable: () => undefined };
    await expect(client.call('list', [input], signal)).rejects.toMatchObject({
      code: 'STORAGE_FAILED',
    });
    expect(getEventListeners(signal, 'abort')).toHaveLength(0);
    expect(await client.call('inspect', ['still-live'])).toBeUndefined();
  } finally {
    await client.close();
  }
});
