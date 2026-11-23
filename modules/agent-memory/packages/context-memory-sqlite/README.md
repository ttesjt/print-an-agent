# @print-an-agent/context-memory-sqlite

SQLite adapter for Context Memory. Each `memoryId` owns one current JSON snapshot row, independent
request receipts and immutable history stored as periodic baselines plus state deltas.
There is no per-item SQL schema. See [versioning and storage rules](../context-memory/VERSIONING.md)
for historical reads, detached forks, legacy initialization and configurable delta-chain limits.

```ts
import { MemoryMeter, MemoryMutations, readMemoryContext } from '@print-an-agent/context-memory';
import { SqliteMemoryStore } from '@print-an-agent/context-memory-sqlite';

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
Agent Base, Workbench, or a product runtime. Give Workflow consumers the guarded domain boundary, not raw SQL.

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

## Source ownership

This package follows the [shared SQLite adapter organization](../../README.md#sqlite-adapter-source-ownership).
Store adapts `MemoryHistoryStore` and consumes the selected Database API. Database owns native
connection setup, schema composition, persisted records, publication and historical reads.

```text
src/
  index.ts                           # Stable named package API
  store/
    index.ts
    sqlite-memory-store.ts           # MemoryHistoryStore facade and asynchronous admission
    types.ts                         # Public Store options composed from lower capabilities
  database/
    index.ts                         # Store-facing database composition API
    initialize-schema.ts             # Atomic assembly of current and history schema initialization
    connection/
      index.ts
      configuration.ts               # Path/timeout validation and the busy-timeout default
      open.ts                        # Open an owned connection or accept an explicit borrowed one
      lifecycle.ts                   # Initialization cleanup, admission guards, fencing and close
      types.ts                       # Connection options and ownership facts
    persistence/
      index.ts
      schema.ts                      # Current snapshot and receipt tables
      snapshots.ts                   # Snapshot SQL reads/writes and raw rows for legacy upgrade
      receipts.ts                    # Receipt SQL reads/writes
      decode-record.ts               # Stored-authority decoding error boundary
    publication/
      index.ts
      commit.ts                      # Ordinary conditional publication
      fork.ts                        # Historical source selection and conditional target creation
      publish-snapshot.ts            # Domain decision followed by history/head publication
      run-transaction.ts             # Receipt arbitration and the single request transaction
      recover-commit.ts              # Rollback, receipt recovery and commit evidence classification
      types.ts                       # Transaction progress facts
    history/
      index.ts
      storage-policy.ts              # New-write delta-chain policy and its default
      format.ts                      # Durable record format and controlled record kinds
      codec.ts                       # Baseline/delta encoding, decoding and canonical digests
      records.ts                     # History row decoding and SQL access
      read-version.ts                # Baseline selection, chain reconstruction and verification
      append-version.ts              # Verify the previous history and append one version
      list-versions.ts               # Version queries with a frozen upper bound
      cursor.ts                      # Cursor version, encoding and scope/limit checks
      schema.ts                      # History DDL, schema format and upgrade admission
      upgrade-legacy.ts              # Seed only the available legacy current revision
      types/                         # History record and public storage-option contracts
      delta/
        index.ts
        types.ts                     # Data patch and path contracts
        diff.ts                      # State differences and encoding-cost selection
        apply.ts                     # Validated patch application
        values.ts                    # Local shared JSON collection predicates
```

Publication consumes Persistence and History; History can read Persistence's current rows. Connection
and Persistence stay independent of those higher features. Delta owns patch operations and consumes
its own local helpers. `database/initialize-schema.ts` composes current and history schema creation;
Store supplies that initializer to Connection. Startup initialization and request publication have
separate transactions and recovery rules.

The facade admits operations asynchronously, then runs native SQL synchronously within the Host.
Connection guards owned or borrowed resource lifetime, admission, cleanup fencing and close.

The public API is `SqliteMemoryStore`, `SqliteMemoryStoreOptions`, `MemoryHistoryStorageOptions`,
`DEFAULT_SQLITE_BUSY_TIMEOUT_MS` and `DEFAULT_MAX_MEMORY_DELTA_CHAIN`. Paths and borrowed databases
are mutually exclusive constructor options; borrowed connections cannot be reconfigured through
`busyTimeoutMs`. Options retain their readonly and optional fields. Schema, record and cursor versions
have distinct owners.

Tests are grouped under `test/unit/database/history/`, `test/integration/database/` for Connection,
Persistence, Publication and History, and `test/integration/workflows/` for Current/History/Model
Workflow consumers. Shared test-only connection, fault, model and counter fixtures live in
`test/support/`. Version-one fixtures preserve exact history, head, receipt and cursor encodings and
verify that reducing the new-write chain limit does not invalidate existing history. The independent qualification workspace compiles public constructor
contracts and emits consumer declarations without private package paths.

`test/context-memory-sqlite-source-boundaries.test.ts` at the repository root declares feature entries
and dependency rules, checks literal source cycles including type-only edges and type-module erasure,
and qualifies accepted/rejected boundaries. It runs in `pnpm test:memory-qualification` and
`pnpm test:architecture`. Runtime ownership, computed imports and semantic equivalence still require
review; code-size thresholds are advisory.
