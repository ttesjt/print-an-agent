# `@print-an-agent/base-request`

Session-aware foreground and Sessionless Request Workflows for Agent Base, with reusable narrow
preparation, invocation, tool and delivery Steps.

`createSessionlessRequestWorkflow()` runs directly over an independent Actor with caller-supplied
history, using `direct`, `stream` or bounded `interaction` mode. It requires no Agent, Session,
Request Journal or persistence. Read the [Sessionless guide](./docs/sessionless.md) for construction,
Step replacement, output, permission and lifetime contracts. The following sections describe the
Session-aware foreground Workflow.

`createRequestWorkflow({ resources, ... })` creates a native `@print-an-agent/workflow-core` Workflow with
its ports and policy bound at construction. Call it with `run({ input, signal })`; it returns the
consumer-defined result directly. The standard
composition uses `bindAgentWorkflow()` from `@print-an-agent/base-runtime` to apply that result to the
originating Agent Run. A condition skip returns `undefined` (no change); an active execution must
produce a response or it fails with `REQUEST_OUTPUT_STATE_INVALID`.

The standard Workflow's `createState` stores the Agent Run as `context.state.agentRun` alongside
per-request working data. Steps access borrowed capabilities and policy through `context.resources`.
`state.response` holds the constructed answer, and `state.completedResponse` records the response
after delivery, including replay. A replacement Step that handles the full response can supply
`state.completedResponse` for the final projection. Override Steps use the effective `context.signal`.
`createState` constructs run-local data, and ports remain owned by their supplying host.
The bound `createOutputSink` is a factory: each request creates or supplies its own sink. Tools,
execution leases and reasoning data remain in per-request state, and trace emitters remain on the
Agent Run. Concurrent requests share prepared ports without sharing mutable request state.

```text
request Workflow
└── runRequest
    ├── prepareRequest
    │   ├── validateRequest
    │   ├── resolveSession
    │   ├── resolveRequestReplay
    │   ├── beginRequest
    │   ├── resolveExecutionTarget
    │   ├── resolveInstructions
    │   ├── loadSessionContext
    │   ├── gatherExternalContext
    │   ├── buildTools
    │   └── buildModelContext
    └── executeRequest
        ├── runAgentInteraction
        │   ├── openResponseStream
        │   ├── invokeActorInteraction
        │   │   └── dispatchInteractionEvent (per accepted event)
        │   │       ├── deliverTextDelta (text-delta)
        │   │       ├── deliverReasoningDelta (reasoning-delta; optional)
        │   │       ├── captureReasoningPresentation (reasoning-delta; optional)
        │   │       ├── buildTurnPresentation (assistant-complete; optional)
        │   │       └── completeAssistantMessage (assistant-complete)
        │   └── buildAgentResponse
        └── completeResponse
```

The five composite Steps are implemented and always resolve their children through the run-scoped
Step Registry. The generic catalog retains deliberate fail-fast leaf placeholders so a partial custom
composition cannot pretend that an unresolved concern was handled.

`createDefaultRequestStepOverrides()` provides concrete text-request Steps over bound
Responsibility routing, session, request-journal, and tool ports. It validates input, resolves a
session and captures its selected branch and navigation revision, resolves
`foreground-interaction` to one immutable Actor snapshot, composes
instructions, loads that branch's context projection plus completed raw tail, creates one bounded
Tool Runtime, publishes final-turn model text and separately tagged readable reasoning through an
`OutputSink`, persists the assistant result and optional replay authority, and closes the response.
The response includes its branch identity and privacy-safe `toolRun` metadata. A selection change
between resolve and begin fails with a structured conflict instead of attaching the request to a
different branch. The empty registry and deny-all permission policy remain the safe composition
defaults. `gatherExternalContext` remains an explicit skip in this profile.

`resolveRequestReplay` is now a concrete optional capability. Supplying an `idempotencyKey` and an
explicit `sessionId` atomically claims a Request Journal record. A completed duplicate returns the
original response through a fresh OutputSink lifecycle without beginning a Session turn, invoking a
provider, or executing a tool. Active, failed, and conflicting duplicates fail with distinct
structured errors rather than being silently re-executed.

Replay authority remains Agent/Session/idempotency-key scoped. A completed replay returns the
original response and original branch identity even when another branch is currently selected. The
response decoder accepts only the current closed response envelope, including its branch identity.

`resolveRequestReplay` and `gatherExternalContext` remain explicitly skippable in the generic catalog
because replay and external context are optional capabilities. The official composition implements
replay and skips external context. A product that needs a materially different lifecycle may override
a leaf, a composite, or the complete `runRequest` entry Step.

The package defines the `RequestJournalPort` and replay behavior without selecting persistence.
Official Memory and restart-safe SQLite journal implementations live in
`@print-an-agent/base-local-adapters`; physical names never enter request fingerprints or replay domain
identity.

```ts
const { sessionId } = await agent.agent.resources.session.resolve({ agentId: agent.identity.id });
const response = await agent.run({
  sessionId,
  idempotencyKey: 'client-operation-42',
  message: 'Perform this request once.',
});
```

`AgentRequestInput.sessionId` opens an existing Session only. Omit it to create a fresh Session and
obtain its identity from `AgentResponse.sessionId` or OutputSink `open`. Supplying an unknown ID fails
before Journal claim or model execution. An idempotency key requires an existing Session ID; callers
needing replay for the first turn can explicitly create through the injected Session port first.

The journal persists a request fingerprint rather than input plaintext, plus the final response or a
bounded failure view. It never stores tool arguments/results, intermediate provider text,
instructions, credentials, or Pi objects. A crash can leave Session and Journal states requiring
explicit exact-record reconciliation; automatic retry, stale detection, and exactly-once external
tool side effects are not claimed.

Fingerprints are opaque, versioned values in the form `request-v1:sha256:<digest>`. The closed
`request-v1` manifest contains exactly the validated message string. Callers cannot append fields
ad hoc, and future semantic inputs must introduce a new manifest version rather than silently
changing the meaning of persisted fingerprints. Large binary content is intentionally not accepted
by this text-only manifest.

The assembled profile maps normalized Session, replay, Actor routing, Tool, Agent Loop, model-turn,
output, and terminal facts into the injected Agent trace emitter. Trace events contain counts and
structured status only, never text or reasoning content. A completed replay emits a
fresh correlated output trace and deliberately emits no Agent Loop, model-turn, or tool-call
events.

## Request execution deadline

`RequestPolicy.timeoutMilliseconds` is the foreground Request Workflow's cooperative execution
deadline. It accepts a positive integer or `null`; `NO_REQUEST_TIMEOUT` and the standard default are
`null`. Disabling the local deadline never disables caller cancellation. A configured deadline
derives a child signal and offers cancellation to the active Engine, Tool, and event-delivery paths.
Only the deadline created by this Request boundary maps to `REQUEST_TIMEOUT`; caller cancellation or
a narrower child timeout retains its own identity.

This is not a hard upper bound on when the public `agent.invoke()` Promise settles. The deadline
starts after `agent-run-started` tracing and ends before terminal Agent Run tracing. Trace sinks and
adapter methods such as Session commit, Request Journal commit, and OutputSink close do not currently
accept `AbortSignal`; once one of those calls has started, runtime waits for it to settle. The
official workflow checks cancellation immediately before and after irreversible terminal writes to
avoid starting more work and to narrow the race window. If the deadline expires during such a write,
the write may already have committed even though the Request eventually returns `REQUEST_TIMEOUT`.
Adapters remain responsible for atomicity and callers must use the existing idempotency contract to
resolve an ambiguous terminal outcome.

This policy does not define Actor-invocation or provider-transport timeouts. Those are separate
execution boundaries with their own future or adapter-owned policies. Request timeout is validated
configuration, not a mandatory field on every Agent Operation, Workflow, or Step.

A signal already aborted before Workflow admission rejects with its original reason. No request
Steps run, no Session or Journal work is admitted, and no OutputSink lifecycle starts. Cancellation
after admission follows the active phase's error and cleanup contracts; a model invocation can
therefore report `MODEL_INVOCATION_CANCELLED` and fail its opened OutputSink.

## Interaction Steps and event delivery

The official `runAgentInteraction` implementation owns interaction scope, trace boundaries, event
delivery, and Tool cleanup. Its business phases resolve through the same Step Registry as the rest of
the request. `dispatchInteractionEvent`, `deliverTextDelta`, `deliverReasoningDelta`, and
`captureReasoningPresentation` declare
`STEP_CARDINALITY.REPEATABLE`; the other interaction Steps declare `AT_MOST_ONCE`.
`deliverReasoningDelta`, `captureReasoningPresentation`, and `buildTurnPresentation` are skippable;
all other interaction Steps are required.
Overrides may replace a leaf, the event dispatcher, or the whole composite;
there is no separate handler registry, nested Workflow Context, or hidden direct call to a default
leaf. Replacing the whole composite also replaces its lifecycle responsibilities.

`RequestInteractionState` lives in `context.state.interaction`. Use
`requireInteractionEvent(context, 'text-delta')` to read a narrowed current event inside its awaited
Step. The current event is cleared after dispatch, including failure. Consumers must not retain that
mutable slot or launch unawaited Step work. Changing text delivery alone does not rewrite the
authoritative assistant message or Session record.

Accepted events run serially, with one awaited dispatch at a time. Each `emit()` Promise completes
only after its event's Steps settle. `RequestPolicy.maxPendingInteractionEvents` defaults to 64 and
counts both active and queued events. A producer that ignores backpressure can exhaust this bound;
that fails with `REQUEST_INTERACTION_EVENT_QUEUE_FULL`, aborts the interaction signal, and discards
queued work. Output-character accounting and normalized-event tracing occur before replaceable
event Steps. Both streamed characters and terminal text are checked against the existing output
budget, including for custom Engines.

The Actor boundary owns event normalization, terminal/result parity, and closing the Engine emitter.
It observes unawaited emit failures and waits for outstanding pre-terminal delivery before publishing
the validated terminal message. Thus Session completion never precedes that validation. Late Engine
events fail with `ACTOR_ENGINE_PROTOCOL_INVALID`; a closed Request delivery endpoint rejects with
`REQUEST_INTERACTION_EVENT_DELIVERY_CLOSED`.

Delivery retains the first failure even if an Engine swallows it. Cancellation and failure stop new
delivery, discard queued events, and await any in-flight Step before Request failure cleanup can
fail the OutputSink. Abort reasons retain timeout identity. Cancellation is cooperative: arbitrary
Engine, Step, or sink code cannot be forcibly interrupted, and an already-started write/commit is not
rolled back. Such implementations must settle their pending work. Tools close on success and failure,
and listener cleanup belongs to the interaction scope. No retry or persistence format change is
introduced by this decomposition.

Actor invocation observes both its effective Step signal and the interaction delivery signal. A
Step executor failure can therefore cancel the active Actor while Core drains that Step; delivery
failure can independently cancel the same Actor. Request cleanup waits for the admitted execution
to settle before releasing Tools, OutputSink state, or Session execution authority.

## Reasoning streaming

`OutputStreamEvent` is the explicit union of `OutputTextDeltaEvent` and
`OutputReasoningDeltaEvent`, aliases of the Model-owned `TextDeltaEvent` and `ReasoningDeltaEvent`.
`OutputSink.write` accepts the entire union as a function-valued contract; text-only handlers are
rejected by strict TypeScript checking. Consumers must narrow by `event.type`, never relabel every
event as assistant text. A text-only sink may explicitly ignore reasoning.

The official profile installs `deliverReasoningDelta` by default. Set
`stepOverrides: { deliverReasoningDelta: SKIP_STEP }` to suppress delivery, or replace that Step
using the ordinary Workflow override mechanism. This controls delivery, not model generation.
Readable reasoning is forwarded from all model turns, including tool-use turns; body text retains
the final-answer policy. An Engine without readable reasoning simply emits no such events.

`RequestPolicy.maxReasoningCharacters` defaults to 64,000 UTF-16 code units, independently of the
body-text budget. The official interaction composite counts normalized reasoning deltas across the
whole request before replaceable event Steps. Exceeding the budget terminates with
`MODEL_REASONING_LIMIT_EXCEEDED`, including when delivery is skipped or overridden; it never
silently truncates. An Engine swallowing the failed emit cannot turn this into success.
Raw Actor consumers own their output policy; this is a Request policy, not a new Engine parameter.
Replacing the entire interaction composite also transfers budget enforcement responsibility.

Reasoning shares ordered delivery, backpressure, cancellation, and failure drainage with text.
Its content never enters trace payloads, assistant final text, Session history, or Request replay.
Memory OutputSink may retain live tagged events for its caller; Session presentation is a separate
optional capability described below. Direct completion remains buffered. Provider signatures and opaque
or redacted reasoning are not presentation content. A readable provider summary is not a promise
to expose the model's complete internal reasoning.

## Reasoning presentation retention

Standard composition installs `captureReasoningPresentation` by default. It accumulates normalized
readable deltas as per-model-turn chunk arrays in bounded Run-local Context, independently of
`deliverReasoningDelta`. Chunks are joined once per block during construction, not on every delta.
Session presentation preserves the ordered `{ modelTurnIndex, text }` blocks. Indices follow
`turn-start` events (one-based); a single-turn Engine without lifecycle events uses index 1.
Empty/filtered turns create no block and remaining indices are not renumbered. An Engine must emit
turn boundaries for a multi-turn interaction; the framework does not infer hidden model calls.
`buildTurnPresentation` freezes the accumulated value after the Actor has validated terminal/result
parity. `completeAssistantMessage` atomically commits that value together with the assistant message
through the same Session adapter's optional `SessionPresentationPort`. Ordinary no-presentation
completion remains unchanged; no empty record is created.

```ts
stepOverrides: {
  captureReasoningPresentation: SKIP_STEP;
}
```

This disables retention without disabling live delivery. Override capture to filter or redact saved
content through `context.state.capturedReasoning` (`CapturedReasoningPresentation`), whose `blocks`
contain `modelTurnIndex` and `chunks`, with a cumulative `characterCount`. Final validation recomputes
the size instead of trusting this counter. Capture does not silently transform live OutputSink events.
Skipping `buildTurnPresentation` also omits the prepared record. There is no Agent-global retention
flag, no second handler registry, and no per-delta database write. Standard composition fails early
with `SESSION_PRESENTATION_NOT_CONFIGURED` if capture is active but its Session adapter lacks the
atomic capability; custom Workflows own their own dependency validation.

Presentation is limited by both the request reasoning budget and
`MAX_SESSION_PRESENTATION_CHARACTERS` (64,000 UTF-16 code units across blocks), plus
`MAX_SESSION_PRESENTATION_BLOCKS` (1,024 nonempty blocks). Storage-bound overflow reports
`SESSION_PRESENTATION_LIMIT_EXCEEDED`, including transformed output from capture/build overrides.
There is no silent truncation. Format and adapter failures preserve their stable Session error codes
through request failure, OutputSink, and Request Journal failure metadata.

Cancelled, invalid, or failed interactions before Session commit discard the partial capture.
Persistence failure leaves no completed answer or orphaned presentation. After a successful Session
commit, a later output-close or Journal failure does not roll back that authority. Run-local buffers
are cleared when the interaction scope ends. Exact display reads use `readTurnPresentation` rather
than history/context APIs; replay remains answer-only and does not recapture or duplicate records.

## Source layout

- Root files own stable request contracts, errors, and policy.
- `workflow/` owns the generic Workflow shape, names, types, and fail-fast Step definitions.
- `default/` owns the official assembled profile's Context, concrete Step overrides, and failure
  lifecycle.
- `interaction/` owns interaction scope, bounded event delivery, and its concrete Step implementations.
- `replay/` owns Request Journal contracts, identity/fingerprint rules, and response wire validation.

Concrete local OutputSink and Request Journal implementations are intentionally owned by
`@print-an-agent/base-local-adapters`.

New directories should follow independent responsibilities or expected implementation families, not
mechanical file kinds. A growing Step implementation should split by cohesive capability group rather
than creating one file per Step.
