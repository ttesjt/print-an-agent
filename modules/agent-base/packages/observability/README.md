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
run identifiers, clock results and event metadata fail fast with `AgentObservabilityError`.
`NOOP_AGENT_TRACE_SINK` is the retention-free default.
The explicit bounded `MemoryAgentTraceAdapter` lives in `@print-an-agent/base-local-adapters`; production
consumers may replace the sink without changing execution contracts.

Event inputs must contain only own enumerable string data properties; accessors, Symbol keys and
non-enumerable fields are rejected. For each `record()` call, the emitter snapshots validated metadata
before requesting another timestamp or queuing delivery. All current event fields are scalar values, so the frozen
snapshot also isolates events from subsequent caller mutation.

The public assertion validators reject Proxy inputs, including transparent and revoked proxies,
before invoking their traps. They narrow the original object, whose property reads must agree with
its validated data descriptors. Emission instead validates and delivers its own detached snapshot;
it retains no reference to the original metadata object.

Emitter `agentId` and `agentRunId` values contain 1–128 characters. The event protocol continues to
accept string metadata up to 256 characters, including IDs in externally supplied persisted events.
These construction and protocol limits are distinct.

Session traces include selected branch identifiers and numeric navigation revisions. A successful
navigation emits one closed `session-navigation-applied` metadata event describing only operation,
Session identity, selected/affected branch identity, and resulting revision. It never includes
messages, context projections, provider output, or other private content.

## Source ownership

- `src/events/` owns the closed event protocol, validation, metadata snapshots and safe error-code
  classification. `schemas/` groups Run/Workflow/Step lifecycle, Session, Request and model execution
  events. Field definitions provide runtime rules and inferred readonly types together;
  `events/types.ts` composes those event families.
- `src/emission/` owns run-scoped sequencing, clock injection, serialized sink writes and failure
  isolation. Its independent ports and options live in `emission/types/`.
- Each feature exposes a deliberate `index.ts`; emission consumes the event entry. Both may use the
  package's shared errors. External consumers use only the root npm entry.

## Verification

`pnpm --filter @print-an-agent/base-observability test` builds the compiled entry, then runs protocol,
input-boundary, error-code and delivery tests plus a public-entry integration test. Typecheck also
compiles `test/types/public-observability.ts` against the package's declarations.

`pnpm test:architecture` includes `test/observability-source-boundaries.test.ts`: the shared checker
scans literal source imports/exports (including type imports), enforces the declared Events/Emission
entries and direction, rejects wildcard exports, and verifies runtime erasure of pure type modules.
Computed imports, semantic ownership and input-validation completeness still require review.
