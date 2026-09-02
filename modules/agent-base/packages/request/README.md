# `@ta-agent/base-request`

The canonical foreground Request Workflow skeleton for Agent Base.

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
        └── completeResponse
```

The three composite Steps are implemented and always resolve their children through the run-scoped
Step Registry. The generic catalog retains deliberate fail-fast leaf placeholders so a partial custom
composition cannot pretend that an unresolved concern was handled.

`createDefaultRequestStepOverrides()` provides the current concrete text-request slice over injected
Responsibility routing, session, request-journal, and tool ports. It validates input, resolves a
session and captures its selected branch and navigation revision, resolves
`foreground-interaction` to one immutable Actor snapshot, composes
instructions, loads that branch's context projection plus completed raw tail, creates one bounded
Tool Runtime, publishes only final-turn model text through an
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
versioned response decoder accepts legacy linear records and maps them to the stable `main` branch.

`resolveRequestReplay` and `gatherExternalContext` remain explicitly skippable in the generic catalog
because replay and external context are optional capabilities. The official composition implements
replay and skips external context. A product that needs a materially different lifecycle may override
a leaf, a composite, or the complete `runRequest` entry Step.

The package defines the `RequestJournalPort` and replay behavior without selecting persistence.
Official Memory and restart-safe SQLite journal implementations live in
`@ta-agent/base-local-adapters`; physical names never enter request fingerprints or replay domain
identity.

```ts
const response = await agent.run({
  sessionId: 'conversation',
  idempotencyKey: 'client-operation-42',
  message: 'Perform this request once.',
});
```

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

The assembled profile maps normalized Session, replay, Actor routing, Tool, Agent Loop, provider
turn, output, and terminal facts into the injected Agent trace emitter. Text deltas remain exclusive
to `OutputSink`; trace events contain counts and structured status only. A completed replay emits a
fresh correlated output trace and deliberately emits no Agent Loop, provider-turn, or tool-call
events.

## Source layout

- Root files own stable request contracts, errors, and policy.
- `workflow/` owns the generic Workflow shape, names, types, and fail-fast Step definitions.
- `default/` owns the official assembled profile's Context, concrete Step overrides, and failure
  lifecycle.
- `replay/` owns Request Journal contracts, identity/fingerprint rules, and response wire validation.

Concrete local OutputSink and Request Journal implementations are intentionally owned by
`@ta-agent/base-local-adapters`.

New directories should follow independent responsibilities or expected implementation families, not
mechanical file kinds. A growing Step implementation should split by cohesive capability group rather
than creating one file per Step.
