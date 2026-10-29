# @ta-agent/context-memory-sqlite

SQLite adapter for Context Memory. Each `memoryId` owns one current JSON snapshot row, independent
request receipts and immutable history stored as periodic baselines plus state deltas.
There is no per-item SQL schema. See [versioning and storage rules](../context-memory/VERSIONING.md)
for historical reads, detached forks, legacy initialization and configurable delta-chain limits.

```ts
import { MemoryMeter, MemoryMutations, readMemoryContext } from '@ta-agent/context-memory';
import { SqliteMemoryStore } from '@ta-agent/context-memory-sqlite';

// measurementRef is resolved by a host-supplied TokenCounter, not by this adapter.
const store = new SqliteMemoryStore({ path: '/existing/directory/memory.sqlite' });
const meter = new MemoryMeter({ counter });
const memory = new MemoryMutations({ store, meter, defaults: { measurementRef: 'my-tokenizer' } });
try {
  await memory.create({ memoryId: 'project:a', requestId: 'create:1' });
  await memory.apply({
    memoryId: 'project:a',
    requestId: 'edit:1',
    expectedRevision: 1,
    commands: [{ op: 'add', content: 'Use concise explanations.' }],
  });
  const context = await readMemoryContext({ store, meter }, { memoryId: 'project:a' });
  console.log(context.text);
} finally {
  // First settle every caller using this store; it does not own an operation runner.
  store.close();
}
```

The host creates the parent directory. `node:sqlite` is the only storage implementation dependency.
The adapter does not invoke models, tokenize text, start background tasks or create resources for
Agent Base, Workbench, or application runtimes. Give Workflow consumers the guarded domain boundary, not raw SQL.

## Consistency and recovery

`BEGIN IMMEDIATE` arbitrates request identity before revision comparison. History, head and receipt commit
in one transaction. Same memory/request/operation/input returns the original receipt, even with an
old expected revision or newly generated candidate item IDs. Changed input returns `REQUEST_CONFLICT`.
Unchanged requests persist receipts without advancing revision. Receipt retention is intentional;
there is no automatic expiry that could make an old request execute again.

Planning, validation and token counting happen outside the write transaction. Cancellation is checked
at admission and before COMMIT; cancellation after a successful commit does not rewrite its result.
On failure, errors distinguish proven `not-committed`, `committed` with a recovered receipt, and
`unknown`. Query `getReceipt(memoryId, requestId)` after reconnecting before retrying uncertain work.
Absence of a receipt while another operation is still running is not proof that it cannot commit.
Corrupt records are errors, never missing documents.

## Resources and execution

`{ path, busyTimeoutMs? }` opens an owned connection. The busy timeout defaults to 5000 ms; it limits
SQLite lock waiting, not model execution. `node:sqlite` is synchronous: an ongoing native lock wait
cannot be interrupted by JavaScript cancellation. Hosts needing nonblocking database work should
provide another adapter/worker. No model deadline is introduced.

`{ database }` borrows an existing `DatabaseSync`; closing the store never closes that connection.
The adapter refuses to initialize or commit inside a caller-owned transaction. Hosts must not change
its schema, close the connection or execute concurrent transactions while it is in use.
Failed initialization closes owned connections, never borrowed ones. `close()` is idempotent on
success. Rollback failure poisons the adapter, preserves both causes and is reported again by close,
even if native connection cleanup later succeeds. Do not treat that lifecycle as successful shutdown.

Tests use real SQLite, independent file connections, gated planning and injected SQL/COMMIT/rollback
faults. They require no external model, provider credentials or network.
