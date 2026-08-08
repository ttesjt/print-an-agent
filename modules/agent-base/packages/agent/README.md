# `@ta-agent/base-agent`

The official assembled Agent Base composition root.

`assembleAgentBase()` accepts Agent Base-owned Actor and Responsibility catalogs plus adapter ports.
It constructs one Responsibility router shared by foreground requests and Session compaction and
requires a resolvable `main` Actor. `createPiFauxAgentBase()`
selects the current offline development profile: Pi's low-level loop, a deterministic faux provider,
in-memory sessions and Request Journal, the canonical request Workflow, and a memory OutputSink
default.

`createPiAgentBase()` is the formal ordinary-provider shortcut. It accepts the closed Pi builtin or
OpenAI-compatible profile, creates the required `main` Actor and configured Responsibilities, and
retains the same replaceable Session, Request Journal, Tool, OutputSink, Workflow/Step, and
observability ports. Its `inspectPiProvider()` and `checkPiProviderReadiness()` surfaces are
metadata-only. Consumers needing multiple Engines compose `createPiProviderRuntime()` with
`assembleAgentBase()` directly.

The assembled API also exposes an explicit `compactSession()` Agent Run. It resolves the registered
`session-compaction` Responsibility and invokes its Actor in direct mode. The Pi faux profile supplies
a deterministic Pi Engine; generic compositions may inject any conforming custom Engine. The
`compactSession` Workflow, Condition, every leaf Step, policy, Actor routing, and Session adapter
remain replaceable.

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

The composition root accepts a replaceable Tool Registry, Actor/Responsibility allow-lists, product
and runtime ceilings, and an execution policy. Tool access defaults to deny-all. An authorized call traverses Pi, the Agent Base Tool
Broker, and Pi's next provider turn before returning a final response with privacy-safe execution
metadata.

The composition accepts an optional `observability` runtime. The retention-free no-op sink is the
default. Consumers may inject `MemoryAgentTraceAdapter` or another `AgentTraceEventSink` to inspect
ordered Agent/Workflow/Step, Actor routing, replay, provider-turn, tool, usage, budget, output, and terminal
metadata. Trace events never contain request/instruction/history/output text, tool payloads,
exception messages, credentials, endpoints, or Pi values. Sink failure is isolated from execution.

The composition structure is the supported production architecture. SQLite supplies a minimal real
durable local Session profile, while both Pi shortcuts intentionally retain memory persistence as
their zero-configuration development default. Ordinary provider invocation is real; a durable
production persistence/credential profile is not implied. Durable replay is a separate minimal Request Journal profile;
the Session adapter supports bounded append-only navigation but does not imply branch merge/delete,
pruning, backup, automatic retry, cross-port transactions, or multi-process ownership.
