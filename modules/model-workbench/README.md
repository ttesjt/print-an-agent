# Model Workbench

Model Workbench is a small control plane for model operations and their resulting assets. Model
code stays outside the Workbench; the Workbench calls a selected Model Capability, uses its bound
Runtime Supports when required, records the Run, and preserves the lineage of accepted model assets.

The active implementation deliberately separates two kinds of input:

- Profiles and Runtime Bindings are JSON-like setup inputs. Callable Model Capability and
  Runtime Support resources are constructed in the host process. Both inputs are resolved before
  the Workbench is created and are not stored or versioned by the Workbench.
- Runs, model parameters, outputs, and lineage are dynamic assets. These are the records whose
  accumulated history belongs in an asset store.

The public construction path is:

```text
static Profile and Runtime Binding setup input
+ process-local Extension Runtime resources
  -> createModelWorkbench()
       -> resolveWorkbenchSetup()
       -> createWorkbenchControlPlane()
  -> workbench.initialization.start()
     or workbench.training.start()
     or workbench.exports.start()
     or workbench.outputInvocations.invoke()
  -> selected Model Capability
     -> completed terminal result
     or accepted opaque execution receipt
  -> workbench.runs.refresh() / wait() / cancel()
  -> bound Execution Support when detached
  -> bound Artifact Handoff Support verifies or materializes the relevant Artifact
  -> terminal Run + immutable Base or additive Modification
     or immutable Output
```

`initialization.start()` always returns a Workbench `runId`. Before dispatch, Workbench validates the
Capability-specific input and persists that exact JSON value on the Run. Stopping `runs.wait()` or
`runs.refresh()` stops only that caller-side recovery attempt and leaves the durable Run recoverable;
cancellation is a separate explicit action. Backend execution identity remains an opaque receipt
owned by the selected Runtime Support and is durably associated with the Run.

`training.start()` accepts a Base plus an ordered Modification ID stack. Workbench derives the exact
Model State receipt, loads every parameter asset, and asks each Artifact's owning Support to verify
and materialize a transient input binding. The Trainer returns either a new Base or one additive
Modification. The terminal Run records the exact source Model State, and the produced asset records
the same source in its lineage. `models.compose()` can derive another ordered Model State without
registering or persisting every combination.

`exports.start()` accepts the same exact Model State shape and materializes it through the shared
Model State preparation service. The Exporter returns a non-empty set of uniquely named Artifact
results. Workbench assigns Output and Artifact identities, verifies every Artifact through the
Exporter slot's bound Support, and atomically commits the terminal Export Run with one immutable
Output. `outputs.get()` returns the accepted Output and its exact source-state lineage.

`outputInvocations.invoke()` starts from an explicit Profile and Output identity. The high-level
route selects that Profile's canonical Invoker; advanced callers may still provide an explicit
`outputInvokerId`. Workbench reuses canonical target resolution, materializes every named Artifact
through the Support recorded in its durable reference, then calls the selected Invoker with those
transient bindings. Both completed and streaming results carry the exact target evidence before any
stream is consumed. The same output Contract validates the completed value or every stream chunk.
Invocation creates no Run, model asset, managed Session, or serving lifecycle.

`outputInvocations.resolve()` is the read-only readiness boundary for a Profile's canonical Output
Invoker. It loads the exact Output, validates Profile ownership and canonical selection, locates and
verifies every Artifact through its recorded Support, and returns a stable target evidence digest
that binds both the selected Invoker and the Artifact Handoff Supports used for verification. It
does not materialize Artifacts, invoke the model, create a Run, or mutate persistence. A sole
Output Invoker is canonical automatically; Profiles with several Invokers must identify one before
they can use this canonical route.

`classifyModelWorkbenchError()` gives application bridges one stable policy boundary without hiding
the original error. It distinguishes invalid request/configuration, target-not-callable, governed
operation, Output Invocation, cancellation, persistence/integrity, and unexpected failures.
Concrete Workbench error codes remain available for diagnostics; consumers do not need to enumerate
them to choose their high-level error handling path.

Profile-scoped discovery is available through `runs.list()`, `models.listBases()`,
`models.listModifications()`, and `outputs.list()`. Each query is bounded and cursor-paginated. Run
discovery can additionally filter by operation, status, and Workbench-recorded creation time. These
queries expose the lineage already stored on immutable asset records; they do not introduce tags,
promotion state, a metrics database, or configuration authority.

Artifact identity is separate from execution identity. A successful producing Capability reports an
Artifact digest and an opaque handoff receipt, but not the Workbench-owned Artifact ID. Workbench
combines those facts with its assigned ID and the bound Support identity, then accepts the resulting
`ArtifactReference` only after that Support verifies it.

Persisted Artifact handoff is also separate from a consumer's transient input. A Trainer can consume
one Base plus an ordered Modification stack whose Artifacts belong to different Supports. Workbench
selects each Support from its `ArtifactReference`, verifies it, and materializes a JSON-like input
binding for that single Capability call. It does not interpret local paths, object-store keys, or
temporary URLs itself.

The Control Plane implements this lifecycle once. Its internal Execution Lifecycle Engine owns
dispatch acceptance, receipt persistence, observation, progress, waiting, and cancellation. Each
operation supplies a typed handler for runtime resolution, terminal result parsing, validation, and
commitment. Initialization, Training, and Export use the same lifecycle rather than copying the
execution loop. Output Invocation deliberately uses its own non-durable streaming call path.

A `starting` Run is itself recoverable. Workbench records `createdAt`, the validated operation
input, and the frozen Profile slot before invoking the Capability. Immediately before invocation it
records `dispatchedAt`. A later `runs.refresh()` or `runs.wait()` can re-drive a `starting` Run with
the same `profileId` and `runId`; a durable Capability bridge must treat that pair as its idempotent
submission identity and return the existing execution or terminal result rather than start a second
backend job. `terminalRecordedAt` is the time Workbench first accepts a terminal observation, not a
backend-reported finish time.

Cancellation also respects the dispatch window. An undispatched `starting` Run can be committed as
cancelled without calling the Capability. For a dispatched `starting` Run, Workbench first performs
the same idempotent recovery to regain its execution receipt or terminal result; only a recovered
running execution is sent to Runtime Support `cancel()`.

`RunObservationError` is limited to failure of the bound Execution Support's `observe()` call.
Progress persistence and terminal commitment happen in later phases and preserve their own
operation or persistence errors instead of being mislabeled as observation failures.

Advanced hosts may call `resolveWorkbenchSetup()` and `createWorkbenchControlPlane()` separately to
provide every persistence port and ID source explicitly. The Setup layer derives digests as evidence
for lineage. A digest is not a user selector,
configuration version, compatibility policy, or prerequisite for ordinary API calls.

See [Extension Runtime Resolution](./docs/extension-runtime-resolution.md) for the separation between
serializable selectors, typed Capability contracts, live resources, and the resolved callable graph.
See [Model Capability Contracts](./docs/model-capability-contracts.md) for the complete Initializer,
Trainer, Exporter, and Output Invoker SPI surface.
See [Local Runtime Supports](./docs/local-runtime-supports.md) for the default Profile-scoped local
Artifact and detached-execution receipt protocols.
See [Using Model Workbench](./docs/using-model-workbench.md) for the public composition boundary,
CLI module contract, and the deterministic local acceptance path.

The optional Python model backend template contains a runnable reference backend and its private
Workbench-side definition. It exercises the same public Capability and Runtime Support boundaries
available to external model projects; it does not make Python or its reference model part of the
Workbench control plane.
The reference backend uses a tiny Transformer to qualify real training on CPU, while remaining
device-aware for explicitly configured CUDA or MPS deployments.

This module must not import Agent Base or product runtimes. Its TypeScript APIs must remain usable
without either module, a database, Python, a model framework, or a process runner.
