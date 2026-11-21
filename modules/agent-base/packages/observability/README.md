# `@print-an-agent/base-observability`

Privacy-safe correlated execution tracing for Agent Base.

The Agent Run ID is the trace root. Agent Run lifecycle events identify the selected Operation, and
nested Operation calls may include only their parent Run ID for correlation. Events use a closed
metadata-only schema version 2 and a strictly increasing per-run sequence. Model-turn start/end
events, model-turn budgets and terminal summaries apply equally to provider-backed and custom Actor
Engines. Prompts, instructions, history,
model output, tool arguments/results,
exception messages, credentials, endpoints, and Pi values are never trace fields.

Tracing is diagnostic: sink and failure-reporter errors are isolated from execution. Invalid
configuration, clock results and event metadata fail fast with `AgentObservabilityError`. `NOOP_AGENT_TRACE_SINK` is the retention-free default.
The explicit bounded `MemoryAgentTraceAdapter` lives in `@print-an-agent/base-local-adapters`; production
consumers may replace the sink without changing execution contracts.

Event inputs must contain only own enumerable string data properties; accessors, Symbol keys and
non-enumerable fields are rejected. The emitter snapshots validated metadata before calling the
injected clock or queuing delivery. All current event fields are scalar values, so the frozen
snapshot also isolates events from subsequent caller mutation.

Emitter `agentId` and `agentRunId` values contain 1–128 characters. The event protocol continues to
accept string metadata up to 256 characters, including IDs in externally supplied persisted events.
These construction and protocol limits are distinct.

Session traces include selected branch identifiers and numeric navigation revisions. A successful
navigation emits one closed `session-navigation-applied` metadata event describing only operation,
Session identity, selected/affected branch identity, and resulting revision. It never includes
messages, context projections, provider output, or other private content.

Assertion validators reject Proxy inputs, including transparent and revoked proxies, without
executing caller traps. Emission captures and validates a stable metadata snapshot before delivery.
