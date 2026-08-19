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
  -> Initializer Capability
     -> completed terminal result
     or accepted opaque execution receipt
  -> workbench.runs.refresh() / wait() / cancel()
  -> bound Execution Support when detached
  -> bound Artifact Handoff Support verifies the reported Artifact
  -> terminal Run + immutable Base
```

`initialization.start()` always returns a Workbench `runId`. Stopping `runs.wait()` stops only the
caller-side wait; cancellation is a separate explicit action. Backend execution identity remains an
opaque receipt owned by the selected Runtime Support and is durably associated with the Run.

Artifact identity is separate from execution identity. A successful producing Capability reports an
Artifact digest and an opaque handoff receipt, but not the Workbench-owned Artifact ID. Workbench
combines those facts with its assigned ID and the bound Support identity, then accepts the resulting
`ArtifactReference` only after that Support verifies it.

The Control Plane implements this lifecycle once. Its internal Execution Lifecycle Engine owns
dispatch acceptance, receipt persistence, observation, progress, waiting, and cancellation. Each
operation supplies a typed handler for runtime resolution, terminal result parsing, validation, and
asset commitment; Initialization is the first handler. New operations extend those slots rather
than copying the execution loop.

`RunObservationError` is limited to failure of the bound Execution Support's `observe()` call.
Progress persistence and terminal commitment happen in later phases and preserve their own
operation or persistence errors instead of being mislabeled as observation failures.

Advanced hosts may call `resolveWorkbenchSetup()` and `createWorkbenchControlPlane()` separately to
provide every persistence port and ID source explicitly. The Setup layer derives digests as evidence
for lineage. A digest is not a user selector,
configuration version, compatibility policy, or prerequisite for ordinary API calls.

See [Extension Runtime Resolution](./docs/extension-runtime-resolution.md) for the separation between
serializable selectors, typed Capability contracts, live resources, and the resolved callable graph.

This module must not import Agent Base or application runtimes. Its TypeScript APIs must remain usable
without either module, a database, Python, a model framework, or a process runner.
