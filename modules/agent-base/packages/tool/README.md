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

```text
src/
  index.ts                         # Stable named package API
  errors.ts                        # Shared AgentToolError
  types/
    identity.ts                    # ToolName and ToolCallId brands
    handler.ts                     # Shared Handler invocation/result contracts
    errors.ts                      # AgentToolErrorCode
  definition/
    index.ts
    types.ts                       # ToolDefinition and DefineToolInput
    names.ts                       # Tool name parsing
    define-tool.ts                 # Definition validation and immutable assembly
    schemas.ts                     # Parameter Schema validation and freezing
    arguments.ts                   # Call argument parsing and immutable values
  registry/
    index.ts
    types.ts                       # ToolRegistry
    registry.ts                    # Immutable registry and empty registry
  permissions/
    index.ts
    types.ts                       # Permission inputs and normalized allow-lists
    policy.ts                      # Default denial and four-layer intersection
  broker/
    index.ts
    types/
      runtime.ts                   # Runtime port and creation options
      inspection.ts                # Metadata-only records and inspection
      policy.ts                    # Execution budget contract
    execution-policy.ts            # Default limits and validation
    call-input.ts                  # Call ID parsing and serialized argument size
    bounded-tool-runtime.ts        # Queue, admission, execution, accounting and closure
    execute-tool-handler.ts        # Cooperative deadline/cancellation and result normalization
```

Features consume each other's named entries. Registry consumes Definition; Permissions consumes
Definition and Registry; Broker composes their public contracts and behavior. Shared identity,
Handler and error facts live at the package's common scope. Definition does not depend on Broker:
its executable Handler contract is shared independently of any particular execution runtime.
Model Invocation remains the owner of the model-facing Schema types and tool protocol.

The Broker Runtime owns all mutable queue, call identity, budget, closure and record state. Input
helpers do not acquire state or move admission ahead of queued execution. Closing the Runtime
prevents queued calls from being admitted; already active work still settles under its existing
signal. After parsing call identity, admission reserves the ID before checking the call budget,
authorization and arguments. Authorization and argument rejections retain that reserved ID and
consume call budget. A duplicate ID creates no additional outcome record. JSON serialization failure
preserves its cause and leaves its ID reserved, without creating an outcome record.

The package continues to expose only its root npm entry. Feature entries are internal architectural
boundaries. Independent pure-type declarations live in the owner's `types.ts` or `types/`; the
small private prepared-call type stays beside its Runtime implementation. Public API names and
Schema-derived argument inference remain stable.

Tool source boundaries, dependency direction, runtime erasure of type modules and static source
cycles (including type-only edges) are checked by the [Tool architecture tests](../../../../test/tool-architecture.test.ts).
These opt-in checks do not resolve computed imports, aliases, external package
internals or runtime resource ownership; see the [verification guide](../../../../docs/development.md#declared-source-feature-boundaries).
