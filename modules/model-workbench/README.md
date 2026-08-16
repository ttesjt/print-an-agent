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
  -> bound Artifact Verifier Support
  -> terminal Run + immutable Base
```

Advanced hosts may call `resolveWorkbenchSetup()` and `createWorkbenchControlPlane()` separately to
provide every persistence port and ID source explicitly. The Setup layer derives digests as evidence
for lineage. A digest is not a user selector,
configuration version, compatibility policy, or prerequisite for ordinary API calls.

See [Extension Runtime Resolution](./docs/extension-runtime-resolution.md) for the separation between
serializable selectors, typed Capability contracts, live resources, and the resolved callable graph.

This module must not import Agent Base or application runtimes. Its TypeScript APIs must remain usable
without either module, a database, Python, a model framework, or a process runner.
