# SQLite Retrieval Memory

`openSqliteRetrievalBackend({ path, busyTimeoutMs? })` opens an owned worker/connection using Node 24.15 and pinned sqlite-vec 0.1.9. The host supplies an existing parent directory, borrows the backend into Memory resources, drains its model/workflow calls, then awaits `backend.close()`. Close stops admission and drains already accepted database operations. It is idempotent and propagates cleanup failure.

Spaces, Entry content, vector representations and request receipts are published in one transaction. Models execute outside transactions. Arbitrary text payloads use lossless JSON encoding, including embedded NUL. Filters constrain the eligible set inside KNN, not after topK. One database supports multiple Spaces; physical vector tables are shared by dimension, not created per memoryId.

Representation headers and text are JSON; canonical vectors are binary float32 in ordinary derived-chunk records and in the rebuildable vec0 index, not repeated as JSON numeric arrays. Entry/representation reads hydrate these records in a single read transaction. The ordinary binary representation remains available if the vector index must be rebuilt. Metadata predicates compile into parameterized, type-aware JSON SQL with a covering eligibility scan; arbitrary keys never become SQL or JSON-path source.

Native SQL executes in the dedicated worker. Cancellation does not forcibly interrupt native statements; it is checked at admission, after native work and before COMMIT. A returned durable receipt is not rolled back by late cancellation. Hosts must not terminate the worker as a substitute for drain.

If rollback fails, the worker fences its connection: all ordinary reads, writes and receipt recovery reject, including requests already queued. Transaction-local rows must never be reported as durable facts. Close still releases the connection and reports the retained cleanup failure; recovery requires a new connection and its committed receipts. An ordinary transaction failure with successful rollback does not fence the connection.

Actual backend limits: dimensions 1–8192, topK 1–4096, list size 1–1000. These are not framework limits. Missing native binaries fail explicitly; no fallback storage or model is chosen. The supplied extension has platform packages for macOS arm64/x64, Linux arm64/x64 and Windows x64; only the current development platform has been exercised here.

## Source ownership

Backend adapts `RetrievalBackend`; its Worker client transports calls to the native Database API.

The package root deliberately exports `openSqliteRetrievalBackend`, `SQLITE_RETRIEVAL_LIMITS`,
`SqliteRetrievalOptions` and `OwnedRetrievalBackend`.

- `src/backend/` owns host configuration, backend creation and adaptation to the main package's ports.
- `src/worker/` owns the Host client, request correlation, cancellation-listener disposal and drain.
  Its ordinary entry exposes only the client. `worker-entry.ts` starts the native runtime;
  `runtime.ts` owns the database and cleanup fence; `dispatch.ts` selects database operations.
- `src/worker/protocol/` owns the private same-build structured-clone protocol and diagnostic codecs.
  Operation arguments and results derive from the main Backend contract. Envelope checks establish
  framing; database/domain owners validate records. This is not an external RPC protocol.
- `src/database/` owns native connection setup, relational schema and synchronous transactions.
  `persistence/` owns ordinary records, `publication/` composes one atomic write, `content/` owns
  coherent Entry reads and pagination, and `search/` owns filtered KNN and hit decoding.
  `vector-codec.ts` owns float32 encoding; `vector-index.ts` owns the rebuildable vec0 index.

The package-level capability snapshot and cancellation flag operations are explicitly shared
ancestor capabilities. Database children use declared shared modules and sibling feature APIs;
the database never depends on Worker implementation details. Models remain outside transactions.

Content cursors use `entry-id-utf8-v1` order and bind the Space identity and published sequence.
Publishing in that Space invalidates an old cursor; publishing elsewhere does not. Page size may
change between requests within the native limit. Search instead checks the representation revision
and index configuration, allowing a newer sequence with the same configuration.

## Verification

Build workspace dependencies before consuming the emitted package. Its native Worker asset is
emitted alongside the client; importing TypeScript source directly is not its supported runtime entry.
Run package tests, typecheck, lint and format checks, then `pnpm test:memory-qualification` from the
repository root for memory domains, real adapters and independent consumers.

Tests separate public/native integration, focused unit behavior, compatibility fixtures and type
consumers. The emitted-asset test runs a real backend using only outputs corresponding to current
source files, so stale JavaScript cannot conceal a broken Worker URL. Child-process fault injection
qualifies abnormal exits, diagnostic preservation, drain and cleanup fencing. Source-boundary checks
and their limits are documented in [Development](../../../../docs/development.md#declared-source-feature-boundaries).
