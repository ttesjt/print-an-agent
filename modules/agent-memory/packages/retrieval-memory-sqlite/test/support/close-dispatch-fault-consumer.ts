import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { RetrievalMemoryError } from '@print-an-agent/retrieval-memory';
import { openSqliteRetrievalBackend } from '@print-an-agent/retrieval-memory-sqlite';

// Node loads the TS subprocess fixture directly; its erased type import uses the ESM .js convention.
const { releaseFailedCloses } = (await import(
  new URL('./close-dispatch-fault-preload.ts', import.meta.url).href
)) as typeof import('./close-dispatch-fault-preload.js');

const backend = await openSqliteRetrievalBackend({ path: ':memory:' });
try {
  const admitted = backend.inspect('admitted');
  const close = backend.close();
  assert.equal(backend.close(), close);
  const outcomes: unknown[] = [];
  void close.then(
    () => outcomes.push(undefined),
    (cause: unknown) => outcomes.push(cause)
  );
  // Dispatch threw synchronously. All rejection microtasks must finish before the next turn,
  // without waiting for the still-live Worker to receive a successful close request.
  await setImmediate();
  assert.equal(outcomes.length, 1, 'close stayed pending after its frame failed to dispatch');
  const error = outcomes[0];
  assert(error instanceof RetrievalMemoryError);
  assert.equal(error.code, 'CLEANUP_FAILED');
  assert(error.cause instanceof RetrievalMemoryError);
  assert.equal(error.cause.code, 'STORAGE_FAILED');
  assert(error.cause.cause instanceof Error);
  assert.equal(error.cause.cause.message, 'injected close dispatch failure');
  assert.equal(await admitted, undefined);
  await assert.rejects(backend.inspect('later'), { code: 'STORAGE_FAILED' });
  await assert.rejects(backend.close(), { code: 'CLEANUP_FAILED' });
} finally {
  // The failed close did not reach the Worker. Release it separately so the fixture cannot hang.
  await releaseFailedCloses();
}
