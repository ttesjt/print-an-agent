import { expect, it, vi } from 'vitest';
import { withCliRuntime } from '../../src/owned-runtime.js';
import type { AgentBaseCliRuntime } from '../../src/contracts.js';

function runtime(close: () => Promise<void>): AgentBaseCliRuntime {
  return { close, run: () => Promise.resolve(), compactSession: () => Promise.resolve() };
}

it('joins execution before closing the owning CLI runtime', async () => {
  const gate = Promise.withResolvers<void>();
  const close = vi.fn(() => Promise.resolve());
  const result = withCliRuntime(runtime(close), async () => {
    await gate.promise;
    return 7;
  });
  expect(close).not.toHaveBeenCalled();
  gate.resolve();
  expect(await result).toBe(7);
  expect(close).toHaveBeenCalledOnce();
});

it.each([true, false])(
  'keeps the exact operation outcome when cleanup also fails (success=%s)',
  async (ok) => {
    const primary = new Error('Operation failed');
    const cleanup = new Error('Cleanup failed');
    const receipt = { status: 'committed', revision: 2 };
    await expect(
      withCliRuntime(
        runtime(() => Promise.reject(cleanup)),
        () => (ok ? Promise.resolve(receipt) : Promise.reject(primary))
      )
    ).rejects.toMatchObject({
      code: 'CLI_RESOURCE_CLEANUP_FAILED',
      cause: {
        operation: ok ? { ok: true, value: receipt } : { ok: false, error: primary },
        cleanup,
      },
    });
  }
);
