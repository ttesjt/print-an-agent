# `@ta-agent/base-agent`

The official assembled Agent Base composition root.

`assembleAgentBase()` accepts Agent Base-owned runtime and adapter ports. `createPiFauxAgentBase()`
selects the current offline development profile: Pi's low-level loop, a deterministic faux provider,
in-memory sessions and Request Journal, the canonical request Workflow, and a memory OutputSink
default.

Callers can opt into local durability without changing the composition root by injecting
`SqliteSessionAdapter` through the existing `session` option. A second independently constructed
adapter and Agent over the same explicit database path receives prior committed turns as model
history. Memory remains the default; the assembled package does not choose a filesystem location.

Request replay is enabled by supplying both `sessionId` and `idempotencyKey`. The memory journal
supports process-local development. Callers that need restart-safe replay inject
`SqliteRequestJournalAdapter` through `requestJournal`; it may use the same explicit database file as
`SqliteSessionAdapter`. A completed duplicate returns the original request ID and response while
performing no Pi call, tool call, or new Session turn.

The composition root accepts replaceable Tool Registry, four-layer permission policy, and execution
policy values. Tool access defaults to deny-all. An authorized call traverses Pi, the Agent Base Tool
Broker, and Pi's next provider turn before returning a final response with privacy-safe execution
metadata.

The composition structure is the supported production architecture. SQLite supplies a minimal real
durable local Session profile, but the default faux-provider composition is intentionally not a
remote-provider production profile. Durable replay is a separate minimal Request Journal profile;
neither SQLite adapter implies navigation, backup, automatic retry, cross-port transactions, or
multi-process ownership.
