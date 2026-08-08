# `@ta-agent/base-actor`

Agent Base-owned LLM Actor invocation and Responsibility routing.

An Actor is a named callable LLM participant backed by a replaceable Engine. A Responsibility is a
registered semantic reason for an LLM call with an ordered configurable Actor candidate list.
Workflow and Step remain the execution-planning authority.

The package contains no provider SDK and has no knowledge of Model Workbench or application runtimes.

Every Engine, including a product-supplied custom Engine, must declare a closed technical capability
profile. Actors can narrow those claims but cannot widen them. Technical capability is separate from
Tool permission; omitted Actor and Responsibility Tool lists deny access.

Interaction-capable Engines declare `interaction.streamable`; direct-only Engines carry no
streamability field. The declaration is a routing promise that the interaction handler can emit
incremental events, not a call-time switch. Direct completion is currently buffered.

The built-in Responsibilities are `foreground-interaction` and `session-compaction`. A registered
Responsibility with no candidate list resolves to the required `main` Actor. An explicit list is
authoritative: disabled candidates are filtered and the first enabled compatible Actor is selected.
Current routing performs no automatic retry on later candidates after invocation failure.

Instruction order is stable: Actor instructions, then Responsibility instructions, then the calling
Step/request instructions. Catalog revisions and resolved routing metadata are immutable snapshots.
Durable catalogs, automatic failover, rich media request values, tokenizer-backed context checks, and
durable Task/work-item lifecycle are deferred.
