# `@ta-agent/base-observability`

Privacy-safe correlated execution tracing for Agent Base.

The Agent Run ID is the trace root. Events use a closed metadata-only schema and a strictly
increasing per-run sequence. Prompts, instructions, history, model output, tool arguments/results,
exception messages, credentials, endpoints, and Pi values are never trace fields.

Tracing is diagnostic and fail-open. `NOOP_AGENT_TRACE_SINK` is the retention-free default.
`MemoryAgentTraceAdapter` is an explicit bounded development adapter; production consumers may
replace the sink without changing execution contracts.
