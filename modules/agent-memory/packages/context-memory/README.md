# @ta-agent/context-memory

Context Memory maintains independent documents keyed by caller-selected `memoryId`. Snapshots contain
ordered `{ id, content, metadata? }` items, configuration, revision and derived token measurement.
Item IDs are system-generated. Ordinary commands add, replace or remove items atomically.

## Contracts

- `resolveMemoryConfig` binds an actual `measurementRef`; no universal token estimator is assumed.
- Text rendering defaults to a newline separator; JSON rendering includes IDs and content.
  Rendering is document configuration, not an implicit per-read override.
- `resolveExecutionPolicy` centralizes finite defaults (three compaction passes, two CAS retries)
  and configurable feedback policy. Explicit `null` disables the corresponding attempt bound.
- `resolveCompactionTarget` supports either direct tokens or base limit × ratio − reserve.
  Overrides never relax the persistent document limit.
- `parseModelOperations` accepts a JSON **operations array**, not an updated document. Model edits
  cannot supply item IDs for additions, metadata, revisions or token counts. Planner replacements
  preserve existing metadata through `projectModelOperations`; public apply replacements replace
  the whole item and omit old metadata when no replacement metadata is provided.
- A host-owned `MemoryStore` atomically arbitrates request identity and revision, updates a complete
  snapshot and records a terminal receipt. Replaying a known request returns its original result.
  No model or token counter runs in the write transaction.

Memory documents are not conversation Sessions. Shared resources are borrowed; closing a database,
Actor or other capability belongs to the host after its in-flight operations have settled.

## Deterministic domain use

`MemoryMutations({ store, meter, defaults?, createItemId?, validateItem? })` is the validated domain
write boundary, not a Workflow executor. Its `create`, `apply` and `configure` methods validate the
whole candidate and enforce the actual rendered budget before calling the store's atomic commit.
They preserve committed/unknown errors and do not report cancellation after a successful commit.
An already-read, validated matching receipt also wins over late cancellation. Before rejecting a
stale apply/configure revision, the boundary rechecks its receipt to recover concurrent replays;
this does not retry the edit or relax CAS for genuinely stale writes.
Empty additions are ignored; blank replacements remove their target; invalid commands publish nothing.

`MemoryMeter` borrows a `TokenCounter<TextTokenInput>` from `@ta-agent/model-invocation-core` and a
renderer. Use `new MemoryMeter({ counter })`, for example with an Actor's `textTokenCounter`, or inject
`resolveCounter(measurementRef, signal)` for explicit host-owned selection. The requested identity must
match the resolved descriptor; no alias, model-name inference or fallback is performed.
It caches only completed measurements in a bounded cache
(`maxCacheEntries`, default 128, zero disables caching), keyed by the full counter descriptor and text.
Every full measurement includes renderer/configuration and item digests. Item counts are planning
hints, never a substitute for the full rendered count. Custom renderers use explicit identities.
Snapshot measurements use the shared `tokens`, `accuracy`, `measurementRef`, `inputProtocolRef` and
`scope` fields, including per-item results. Persistence preserves and validates this evidence.
Finite context/item token budgets require `exact` accuracy; estimates fail with
`TOKEN_MEASUREMENT_INEXACT` before commit. Unbounded documents may store estimates.

`readMemoryContext({ store, meter }, input)` returns an entire snapshot and its actual rendered text.
Reads can select a `measurementRef` but not a temporary renderer/separator. Default `enforce` rejects an
oversized result; explicit `report` returns it with budget status. No read truncates, invokes a model,
changes configuration or advances revision. Disabled budgets return `unbounded`, not a fake pass.
`report` may return estimated results; its budget comparison is descriptive, not proof of exact fit.
Even a cached estimated count cannot satisfy a later finite `enforce` read.

The host should give Workflow consumers this domain boundary rather than a raw store writer. The
store port and persistence decision helpers are for adapter composition and contract testing; they
do not replace token counting or provide a second unvalidated Workflow write path.
