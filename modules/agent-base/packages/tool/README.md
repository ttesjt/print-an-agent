# `@print-an-agent/base-tool`

Provider-independent tool schemas, immutable registries, permission intersection, and bounded
run-scoped execution for Agent Base.

Provider output is always a proposal. A tool executes only when it is registered, explicitly allowed
by the Responsibility, Actor, product, and runtime authority layers, valid for the Agent Base-owned schema, and within the configured call,
argument, deadline, and result budgets.

Each request owns a fresh runtime. Calls are serialized in arrival order, call IDs are reserved before
dispatch, and ordinary implementation errors become bounded recoverable results. Authority, schema,
cancellation, deadline, and budget failures are structured terminal errors. Inspection exposes only
tool/call identity, status, timing, and character counts—not arguments or result text.

`execute(proposal, { signal })` accepts per-call cancellation independently of the model's proposal.
It combines that signal with the runtime owner's signal; neither source can replace or abort the
other. Queued calls check cancellation before dispatch. Actor-bound tools automatically inherit the
current invocation signal, and Engine adapters may add a narrower local signal.

Cancellation and tool deadlines are cooperative: the handler receives a single effective signal,
and execution waits for the handler to settle before reporting cancellation or timeout. This keeps
Request cleanup and subsequent calls from overtaking active handler work. A handler that ignores
cancellation can delay settlement indefinitely; the Broker cannot force-stop JavaScript or undo
external effects. Timers are cleared on cancellation or settlement, and the first cancellation
source determines the error even when cleanup outlasts a later deadline.

The package contains no Pi, database, product tool, or global registry implementation.

## Source layout

- Root files own stable contracts, schemas, registry, permission, execution policy, and errors.
- `broker/` owns the stateful run-scoped execution lifecycle.
