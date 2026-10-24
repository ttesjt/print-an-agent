# SQLite Retrieval Memory

`openSqliteRetrievalBackend({ path, busyTimeoutMs? })` opens an owned worker/connection using Node 24.15 and pinned sqlite-vec 0.1.9. The host supplies an existing parent directory, borrows the backend into Memory resources, drains its model/workflow calls, then awaits `backend.close()`. Close stops admission and drains already accepted database operations. It is idempotent and propagates cleanup failure.

Spaces, Entry content, vector representations and request receipts are published in one transaction. Models execute outside transactions. Arbitrary text payloads use lossless JSON encoding, including embedded NUL. Filters constrain the eligible set inside KNN, not after topK. One database supports multiple Spaces; physical vector tables are shared by dimension, not created per memoryId.

Representation headers and text are JSON; canonical vectors are binary float32 in ordinary derived-chunk records and in the rebuildable vec0 index, not repeated as JSON numeric arrays. Entry/representation reads hydrate these records in a single read transaction. The ordinary binary representation remains available if the vector index must be rebuilt. Metadata predicates compile into parameterized, type-aware JSON SQL with a covering eligibility scan; arbitrary keys never become SQL or JSON-path source.

Native SQL executes in the dedicated worker. Cancellation does not forcibly interrupt native statements; it is checked at admission, after native work and before COMMIT. A returned durable receipt is not rolled back by late cancellation. Hosts must not terminate the worker as a substitute for drain.

If rollback fails, the worker fences its connection: all ordinary reads, writes and receipt recovery reject, including requests already queued. Transaction-local rows must never be reported as durable facts. Close still releases the connection and reports the retained cleanup failure; recovery requires a new connection and its committed receipts. An ordinary transaction failure with successful rollback does not fence the connection.

Actual backend limits: dimensions 1–8192, topK 1–4096, list size 1–1000. These are not framework limits. Missing native binaries fail explicitly; no fallback storage or model is chosen. The supplied extension has platform packages for macOS arm64/x64, Linux arm64/x64 and Windows x64; only the current development platform has been exercised here.
