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

Each Actor owns an independent `invocationPolicy`. Its `timeoutMilliseconds` is either a supported
positive integer or `NO_ACTOR_INVOCATION_TIMEOUT`; omission and the standard default both mean no
automatic deadline. The policy applies to both interaction and direct invocation and is deliberately
separate from provider configuration and generation `invocationConfig`. A configured deadline
creates one child cancellation boundary, passes the Engine one effective `AbortSignal`, never aborts
its parent, and maps only its own expiry to `ACTOR_INVOCATION_TIMEOUT`. Parent cancellation and
authoritative Engine protocol failures retain their original identity. Cancellation is cooperative:
an Engine that ignores its signal may continue work, while the Actor waits for settlement and then
still reports its expired deadline.

Interaction tools borrow the Request-owned runtime and its budgets. Each call additionally inherits
the current Actor invocation signal, including cancellation from its invoking Step. Engines may
supply a narrower signal through `tools.execute(proposal, { signal })`, but cannot remove inherited
cancellation. Custom Tool runtimes must honor this per-call signal and settle active handlers before
reporting cancellation; the Actor wrapper does not close or take ownership of the runtime.

The resolved Actor boundary enforces `maxModelTurns` for every Engine by counting normalized
`turn-start` events. A terminal-only Engine consumes the provable minimum of one model turn. Custom
Engines are trusted executable infrastructure and must emit `turn-start` before each real model
invocation; hidden calls cannot be discovered by a generic framework boundary. Provider adapters may
also stop proactively before another invocation to avoid unnecessary cost.

The Engine emitter closes when its invocation settles. The boundary observes each returned emit
Promise, preserves the first protocol or downstream failure, and drains outstanding pre-terminal
delivery before validating and publishing the terminal/result pair. Catching a rejected emit cannot
turn that interaction into success. Late emission fails with `ACTOR_ENGINE_PROTOCOL_INVALID` and
never reaches downstream. Delivery scheduling and capacity belong to the consuming workflow; the
Actor boundary does not add a second event queue. Engines should await emit for backpressure and
must honor cancellation. On Engine failure the boundary closes emission immediately; the consumer
owns draining already-started delivery before disposing its resources.

The built-in Responsibilities are `foreground-interaction` and `session-compaction`. A registered
Responsibility with no candidate list resolves to the required `main` Actor. An explicit list is
authoritative: disabled candidates are filtered and the first enabled compatible Actor is selected.
Current routing performs no automatic retry on later candidates after invocation failure.

Instruction order is stable: Actor instructions, then Responsibility instructions, then the calling
Step/request instructions. Catalog revisions and resolved routing metadata are immutable snapshots.
Durable catalogs, automatic failover, rich media request values, tokenizer-backed context checks, and
durable Task/work-item lifecycle are deferred.
