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
model runtime, session, and tool ports. It validates input, resolves a session and execution target,
composes instructions, loads completed history, creates one bounded Tool Runtime, publishes only
final-turn model text through an `OutputSink`, persists the assistant result, and closes the response.
The response includes privacy-safe `toolRun` metadata. The empty registry and deny-all permission
policy remain the safe composition defaults. `resolveRequestReplay` and `gatherExternalContext` are
explicit skips in this profile.

`resolveRequestReplay` and `gatherExternalContext` are explicitly skippable because stateless replay
handling and external context are optional capabilities. All other Steps are required by this
canonical shape. A product that needs a materially different lifecycle may override a composite or
the complete `runRequest` entry Step.

This package contains no Pi or database implementation. Pi and persistence remain injected adapters;
the memory OutputSink is a deterministic reference implementation of the request-owned publication
contract.

## Source layout

- Root files own stable request contracts, errors, and policy.
- `workflow/` owns the generic Workflow shape, names, types, and fail-fast Step definitions.
- `default/` owns the official assembled profile's Context, concrete Step overrides, and failure
  lifecycle.
- `adapters/` owns concrete replaceable boundary implementations such as `MemoryOutputSink`.

New directories should follow independent responsibilities or expected implementation families, not
mechanical file kinds. A growing Step implementation should split by cohesive capability group rather
than creating one file per Step.
