# `@ta-agent/base-observability`

Privacy-safe correlated execution tracing for Agent Base.

The Agent Run ID is the trace root. Agent Run lifecycle events identify the selected Operation, and
nested Operation calls may include only their parent Run ID for correlation. Events use a closed
metadata-only schema and a strictly increasing per-run sequence. Prompts, instructions, history,
model output, tool arguments/results,
exception messages, credentials, endpoints, and Pi values are never trace fields.

Tracing is diagnostic and fail-open. `NOOP_AGENT_TRACE_SINK` is the retention-free default.
`MemoryAgentTraceAdapter` is an explicit bounded development adapter; production consumers may
replace the sink without changing execution contracts.

Session traces include selected branch identifiers and numeric navigation revisions. A successful
navigation emits one closed `session-navigation-applied` metadata event describing only operation,
Session identity, selected/affected branch identity, and resulting revision. It never includes
messages, context projections, provider output, or other private content.
