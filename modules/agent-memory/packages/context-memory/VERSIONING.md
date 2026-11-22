# Immutable versions and detached forks

History is an explicit `MemoryHistoryStore` capability, not a requirement imposed on current-only
adapters. Its references are `{ memoryId, revision }` within one store authority. IDs must be
nonblank, NUL-free, well-formed Unicode. Physical history encoding belongs to adapters, not Workflows.

The domain contracts and operations live in the package's `history` feature. `workflows/history`
provides the narrow resource/Definition/Bundle installation, while `workflows/versioned` composes
current operations with history and explicit historical rendering. Physical schema and reconstruction
remain owned by `context-memory-sqlite`; source organization does not change the durable format.

## Public Bundle

```ts
import {
  createVersionedContextMemoryResources,
  createVersionedContextMemoryBundle,
} from '@print-an-agent/context-memory';

// Borrow a MemoryHistoryStore and an explicitly configured meter. The host owns cleanup.
const resources = createVersionedContextMemoryResources({
  store,
  meter,
  defaults: { measurementRef },
});
const bundle = createVersionedContextMemoryBundle({ resources });
await bundle.workflows.create.run({ input: { memoryId: 'notes', requestId: 'create' } });
await bundle.workflows.apply.run({
  input: {
    memoryId: 'notes',
    requestId: 'edit',
    expectedRevision: 1,
    commands: [{ op: 'add', content: 'A decision.' }],
  },
});
const old = await bundle.workflows.inspectVersion.run({
  input: { memoryId: 'notes', revision: 1 },
});
const page = await bundle.workflows.listVersions.run({ input: { memoryId: 'notes', limit: 20 } });
await bundle.workflows.fork.run({
  input: { memoryId: 'experiment', requestId: 'fork', source: { memoryId: 'notes', revision: 2 } },
});
const context = await bundle.workflows.readVersionContext.run({
  input: { memoryId: 'notes', revision: 1 },
});
```

- `inspectVersion` returns the exact persisted snapshot without measuring. A missing version raises
  `MEMORY_VERSION_NOT_FOUND`; malformed history raises `HISTORY_CORRUPT`. `readMemoryVersionContext`
  on a current-only adapter raises `HISTORY_UNAVAILABLE`. None silently returns head.
- `listVersions` returns descending references and a stable `throughRevision`; concurrent appends
  do not change subsequent pages. Keep the same memoryId/limit when using nextCursor. Default limit
  is 20, maximum 100. Cursors are opaque and bounded; they are not authorization.
- `fork` conditionally creates a new document at revision 1 from the exact source state, including
  item IDs/order/metadata, config and measurement. It needs no model, counter or renderer and does
  not copy source receipts or ancestor history. Source and target must differ and share an authority.
- The target has independent history. Removing the source does not invalidate the target's own
  versions. It does not promise that deleted source history remains available.
- Request arbitration precedes source reads. Replay the same target/request/source after uncertain
  delivery; a matching receipt remains recoverable even if the source is now unavailable.
- `createContextMemoryHistoryBundle({ resources: createContextMemoryHistoryResources(store) })`
  installs only inspectVersion/listVersions/fork/getReceipt, with no measurement resources.
- All history factories expose normal named Step, Executor and lifecycle customization. Complete
  definitions can be replaced in either Bundle. No Registry or second resource owner is created.

Each real change commits a version. An unchanged operation preserves the original snapshot,
including measurement, and only records its request receipt. A single apply command batch is atomic;
multiple calls are not a staged transaction. Historical rendering can use a different counter but
does not overwrite a historical snapshot with the resulting measurement.

Historical rendering is an explicit `readVersionContext` Workflow / `readMemoryVersionContext`
domain function. Existing `ReadContextInput`, ordinary `readContext`, and Agent Base management
contracts stay current-only; installing history does not silently expand their behavior. The
historical entry selects the stored version/config before measuring it. The host must provide a
meter capable of resolving that version's measurementRef; this Workflow does not acquire counter
implementations or guess them from the current head.

## Default SQLite storage

```ts
const store = new SqliteMemoryStore({
  path: '/existing/directory/memory.sqlite',
  history: { maxDeltaChain: 16 }, // optional; default 32
});
```

There is one current full materialized snapshot, immutable history records, and request receipts.
The initial/fork version is a complete baseline. Later records use deterministic JSON state deltas,
including text splices and array changes. The adapter writes a new baseline after maxDeltaChain
consecutive deltas, or earlier when a delta would not be smaller than the complete baseline payload.
The positive safe-integer limit is an adapter option, not Memory document configuration.
Changing it governs new writes; it does not rewrite existing historical chains created under an
earlier setting. Those versions retain their original reconstruction depth.

History reads verify format, identity/revision, continuity, depth and canonical state digest. The
codec never reruns business commands, planners, counters or renderers. Each baseline can be restored
without older records; subsequent retained deltas require their baseline/preceding chain.
New history, materialized head and receipt publish in one SQLite transaction.

Existing current-only databases are upgraded transactionally: their current revision becomes the
first available historical baseline. Its revision and old receipts are preserved; earlier versions
cannot be invented and remain unavailable. Reopen does not recreate missing history after the
upgrade, and unknown schema formats are rejected.

Rollback failure fences all adapter operations, including receipt/history queries, and remains a
close failure. A successful edit does not imply successful cleanup. Connections and business calls
remain host-owned; borrowed databases are not closed by a Bundle or by the store.

Storage grows with retained changes. Incremental encoding is not an infinite-capacity guarantee:
large global rewrites may offer little savings, receipts also grow, and physical database size
includes indexes, row metadata and free pages in addition to encoded payloads.

There is no automatic pruning, shared ancestor graph, merge, Session binding, Turn checkpoint writer
or model-driven pre/post processing. Applications own references and must coordinate any future
removal with their history needs. Choosing history does not change Workflow execution ownership.
