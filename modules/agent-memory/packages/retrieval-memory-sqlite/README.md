# SQLite Retrieval Memory

`openSqliteRetrievalBackend({ path, busyTimeoutMs? })` opens an owned worker/connection using Node 24.15 and pinned sqlite-vec 0.1.9. The host supplies an existing parent directory, borrows the backend into Memory resources, drains its model/workflow calls, then awaits `backend.close()`. Close stops admission and drains already accepted database operations. It is idempotent and propagates cleanup failure.

Spaces, Entry content, vector representations and request receipts are published in one transaction. Models execute outside transactions. Arbitrary text payloads use lossless JSON encoding, including embedded NUL. Filters constrain the eligible set inside KNN, not after topK. One database supports multiple Spaces; physical vector tables are shared by dimension, not created per memoryId.

Native SQL executes in the dedicated worker. Cancellation does not forcibly interrupt native statements; it is checked at admission, after native work and before COMMIT. A returned durable receipt is not rolled back by late cancellation. Hosts must not terminate the worker as a substitute for drain.

Actual backend limits: dimensions 1–8192, topK 1–4096, list size 1–1000. These are not framework limits. Missing native binaries fail explicitly; no fallback storage or model is chosen. The supplied extension has platform packages for macOS arm64/x64, Linux arm64/x64 and Windows x64; only the current development platform has been exercised here.
