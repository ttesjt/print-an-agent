# `@ta-agent/base-tool`

Provider-independent tool schemas, immutable registries, permission intersection, and bounded
run-scoped execution for Agent Base.

Provider output is always a proposal. A tool executes only when it is registered, explicitly allowed
by every authority layer, valid for the Agent Base-owned schema, and within the configured call,
argument, deadline, and result budgets.

Each request owns a fresh runtime. Calls are serialized in arrival order, call IDs are reserved before
dispatch, and ordinary implementation errors become bounded recoverable results. Authority, schema,
cancellation, deadline, and budget failures are structured terminal errors. Inspection exposes only
tool/call identity, status, timing, and character counts—not arguments or result text.

The package contains no Pi, database, product tool, or global registry implementation.

## Source layout

- Root files own stable contracts, schemas, registry, permission, execution policy, and errors.
- `broker/` owns the stateful run-scoped execution lifecycle.
