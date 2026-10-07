# Agent Base application boundary

Agent Web's Node adapter consumes only Agent Base package-root public exports. Reusable UI
contracts, React components, styles and the Gallery do not depend on it. The browser never loads
the Node adapter or provider credentials.

One app-owned managed composition Definition coordinates namespace, Identity/Config authority,
runtime ports, Session management and Session navigation. The official Standalone profile supplies
namespace and authority provisioning; it does not dictate this application's config codec or
materializer. Agent Web stores its typed instructions/response-style config in the authority,
not a Standalone provider manifest. The host injects Engine, tools and safe tool labels.

Memory state is scoped to one backend instance. Directory state is one Agent directory/database,
and can be reopened by another instance. Both profiles use coordinated official Session/Journal
persistence; no SQL statements or storage internals are embedded in the web adapter.

Navigation goes through the standalone Session Navigation service, not an invented Agent
Operation. Metadata rename uses the injected public Session port. Revision tokens remain opaque
strings in the browser and are validated at the application mapping boundary.

The replaceable request dispatch Step projects model-turn ordinals and safe tool status while
preserving the standard event dispatcher and reasoning capture Steps. Each interaction owns its
OutputSink and tool buffer. Awaited consumers provide ordering/backpressure. Observability trace
is never used as a UI event bus. Requested branch/revision is checked before Turn admission;
the standard Session CAS then protects concurrent admission.

Completed UI events are emitted only after the public Agent invocation settles and the committed
Turn and presentation have been read from Session authority. History reconstructs completed branch
lineage and failed Turns, pages in causal order, and reads reasoning presentation separately.
Completed lineage is never reordered by timestamp or Turn ID. Failed Turns on the displayed branch
are inserted after their visible completed parent, retaining adapter admission order among failed
siblings. Failures whose parent is outside the visible lineage are excluded, as are failures from
other branches. Pagination uses that same ordered projection and exact Turn-ID cursors.
Failed/cancelled partial reasoning is not promoted to successful history. Cancellation is
cooperative; commits and other non-cancellable I/O may finish after cancellation, so an interrupted
client must reconcile authoritative history. No default wall-clock deadline is imposed.

## Explicit current limits

- Tool activity has safe labels/status only; raw arguments, results, trace and provider payloads
  are never projected. Session does not persist tool presentation, so reopened history has no tool
  activity records. This is not an assertion that no tools ran.
- History uses the public Session snapshot API before paging. Page size bounds the transport
  response, not backend snapshot I/O or memory cost.
- Persisted-target requests use interaction IDs as Request Journal idempotency keys. A new draft
  has no Session identity; retry after a lost new-session response requires reconciliation rather
  than a promise of global exactly-once creation.
- Display-name mutation and compaction controls are not offered by this application boundary.
  Agent ID is immutable; a future display-name feature must use a real public authority contract.

The qualification tests exercise Memory and directory/SQLite profiles through the same public UI
ports, including revisions, reasoning history, branching, lifecycle, coordinated purge and safe
stream delivery. A host may replace the adapter without modifying reusable UI packages.
