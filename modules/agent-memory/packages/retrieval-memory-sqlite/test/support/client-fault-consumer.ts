import assert from 'node:assert/strict';
import { RetrievalMemoryError } from '@print-an-agent/retrieval-memory';
import { openSqliteRetrievalBackend } from '@print-an-agent/retrieval-memory-sqlite';

const backend = await openSqliteRetrievalBackend({ path: ':memory:' });
const pending = [backend.inspect('first'), backend.inspect('second')];
for (const outcome of await Promise.allSettled(pending)) {
  assert.equal(outcome.status, 'rejected');
  if (outcome.status === 'rejected') {
    const reason: unknown = outcome.reason;
    assert(reason instanceof RetrievalMemoryError);
    assert.equal(reason.code, 'STORAGE_FAILED');
  }
}
await assert.rejects(backend.inspect('later'), { code: 'STORAGE_FAILED' });
const close = backend.close();
assert.equal(backend.close(), close);
await assert.rejects(close, { code: 'CLEANUP_FAILED' });
// Successful subprocess exit establishes that close released the actual Worker in both modes.
