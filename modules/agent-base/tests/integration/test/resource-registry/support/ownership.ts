import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, expect } from 'vitest';
import type { ResourceScope } from '@ta-agent/base-composition/resource-registry';

const cleanup: {
  readonly kind: 'resource' | 'directory';
  readonly release: () => void | Promise<void>;
}[] = [];
afterEach(async () => {
  const failures: unknown[] = [];
  const entries = cleanup.splice(0).reverse();
  for (const { release } of entries.filter((entry) => entry.kind === 'resource')) {
    try {
      await release();
    } catch (cause) {
      failures.push(cause);
    }
  }
  // Never remove storage after an unexpected/unconfirmed resource cleanup failure.
  if (failures.length === 0)
    for (const { release } of entries.filter((entry) => entry.kind === 'directory')) {
      try {
        await release();
      } catch (cause) {
        failures.push(cause);
      }
    }
  if (failures.length !== 0) throw new AggregateError(failures, 'Qualification teardown failed.');
});
export async function paths() {
  const directory = await mkdtemp(join(tmpdir(), 'registry-memory-consumer-'));
  cleanup.push({
    kind: 'directory',
    release: () => rm(directory, { recursive: true, force: true }),
  });
  return {
    context: join(directory, 'context.sqlite'),
    retrieval: join(directory, 'retrieval.sqlite'),
  };
}
export function ownScope(scope: ResourceScope, expectedFailure = false) {
  cleanup.push({
    kind: 'resource',
    release: async () => {
      if (expectedFailure)
        await expect(scope.close({ mode: 'abort' })).rejects.toMatchObject({
          code: 'RESOURCE_CLEANUP_FAILED',
        });
      else await scope.close({ mode: 'abort' });
    },
  });
  return scope;
}
