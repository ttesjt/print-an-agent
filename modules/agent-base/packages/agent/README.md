# `@ta-agent/base-agent`

The official assembled Agent Base composition root.

`assembleAgentBase()` accepts Agent Base-owned runtime and adapter ports. `createPiFauxAgentBase()`
selects the current offline development profile: Pi's low-level loop, a deterministic faux provider,
in-memory sessions and Request Journal, the canonical request Workflow, and a memory OutputSink
default.

The assembled API also exposes an explicit `compactSession()` Agent Run. `createPiFauxAgentBase()`
wires its deterministic Pi direct-completion runtime; generic compositions may inject another
`SessionCompactionRuntime`. The `compactSession` Workflow, Condition, every leaf Step, policy,
runtime, and Session adapter remain replaceable. A generic composition without a compaction runtime
continues to serve requests and fails `compactSession()` immediately with a structured
not-configured error.

Compaction is not automatically scheduled after a response. It persists a revisioned projection
through a completed Turn boundary and leaves the raw Session history unchanged. A later request loads
the projection plus uncompacted completed turns; a completed Request replay still bypasses Session
mutation and provider execution.

The assembled API exposes `navigateSession()` as an independent Agent Run using the normal
Agent/Workflow/Step machinery. Its default Workflow supports inspect, select, fork, and
non-destructive rewind. The Workflow, each leaf Step, ID factories, Session adapter, and trace sink
remain replaceable. Requests capture exact selected-branch authority before beginning, and
compaction defaults to the selected branch while allowing an explicit branch target.

Callers can opt into local durability without changing the composition root by injecting
`SqliteSessionAdapter` through the existing `session` option. A second independently constructed
adapter and Agent over the same explicit database path receives prior committed turns as model
history. Memory remains the default; the assembled package does not choose a filesystem location.

Request replay is enabled by supplying both `sessionId` and `idempotencyKey`. The memory journal
supports process-local development. Callers that need restart-safe replay inject
`SqliteRequestJournalAdapter` through `requestJournal`; it may use the same explicit database file as
`SqliteSessionAdapter`. A completed duplicate returns the original request ID, branch identity, and
response while performing no Pi call, tool call, or new Session turn.

The composition root accepts replaceable Tool Registry, four-layer permission policy, and execution
policy values. Tool access defaults to deny-all. An authorized call traverses Pi, the Agent Base Tool
Broker, and Pi's next provider turn before returning a final response with privacy-safe execution
metadata.

The composition accepts an optional `observability` runtime. The retention-free no-op sink is the
default. Consumers may inject `MemoryAgentTraceAdapter` or another `AgentTraceEventSink` to inspect
ordered Agent/Workflow/Step, replay, provider-turn, tool, usage, budget, output, and terminal
metadata. Trace events never contain request/instruction/history/output text, tool payloads,
exception messages, credentials, endpoints, or Pi values. Sink failure is isolated from execution.

The composition structure is the supported production architecture. SQLite supplies a minimal real
durable local Session profile, but the default faux-provider composition is intentionally not a
remote-provider production profile. Durable replay is a separate minimal Request Journal profile;
the Session adapter supports bounded append-only navigation but does not imply branch merge/delete,
pruning, backup, automatic retry, cross-port transactions, or multi-process ownership.
