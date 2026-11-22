import { expect, it } from 'vitest';
import { fixture } from '../../support/fixture.js';
it('drains accepted operations and rejects new work when close starts', async () => {
  const f = await fixture();
  await f.create();
  const pending = f.backend.inspect('space');
  const close = f.backend.close();
  expect((await pending)?.memoryId).toBe('space');
  await close;
  await f.backend.close();
  await expect(f.backend.inspect('space')).rejects.toMatchObject({ code: 'STORAGE_FAILED' });
});
