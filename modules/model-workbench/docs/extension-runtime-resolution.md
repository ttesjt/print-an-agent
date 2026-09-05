# Extension Runtime Resolution

The Model Workbench Control Plane receives only a fully resolved setup. Static authoring data and
live resources meet outside the Control Plane:

```text
static Profile and Runtime Binding config
+ callable Extension Runtime resources
-> resolveWorkbenchSetup()
-> immutable ResolvedWorkbenchSetup
-> createWorkbenchControlPlane()
```

## The two inputs

Static config contains only JSON-like selectors. It can be loaded from a TypeScript file, JSON, or
another application-owned source:

```ts
const setupInput = {
  runtimeBindings: [
    {
      kind: RuntimeBindingKind.Binding,
      runtimeBindingId: 'research.local',
      supports: {
        artifactHandoffId: 'artifacts.local',
        executionSupportId: 'execution.local',
      },
    },
  ],
  profiles: [
    {
      profileId: 'research-model',
      initializers: [
        {
          initializerId: 'import',
          capabilityId: 'models.import',
          runtimeBindingId: 'research.local',
        },
      ],
      trainers: [
        {
          trainerId: 'lora',
          capabilityId: 'models.train-lora',
          runtimeBindingId: 'research.local',
        },
      ],
      exporters: [
        {
          exporterId: 'gguf',
          capabilityId: 'models.export-gguf',
          runtimeBindingId: 'research.local',
        },
      ],
      outputInvokers: [
        {
          outputInvokerId: 'llama-cpp',
          capabilityId: 'models.invoke-llama-cpp',
          runtimeBindingId: 'research.local',
        },
      ],
      canonicalOutputInvokerId: 'llama-cpp',
    },
  ],
};
```

Extension Runtime resources contain functions and live dependencies. They are ordinary process-local
objects and are neither serialized nor stored by Workbench:

```ts
const extensionResources = {
  modelCapabilities: [
    defineInitializerCapability({
      capabilityId: 'models.import',
      input: importInputContract,
      initialize: async ({ input }) => {
        const artifact = await modelBackend.import(input.source);
        return {
          kind: 'completed',
          terminal: {
            status: 'succeeded',
            result: {
              artifact: {
                digest: artifact.digest,
                receipt: artifact.receipt,
              },
            },
          },
        };
      },
    }),
    defineTrainerCapability({
      capabilityId: 'models.train-lora',
      input: trainingInputContract,
      train: ({ source, input }) => modelBackend.train(source, input),
    }),
  ],
  runtimeSupports: [
    defineArtifactHandoffSupport({
      runtimeSupportId: 'artifacts.local',
      verify: ({ artifact }) => localArtifacts.verify(artifact),
      materialize: ({ artifact }) => localArtifacts.openInput(artifact.handoff.receipt),
    }),
    defineExecutionSupport({
      runtimeSupportId: 'execution.local',
      observe: ({ executionReceipt }) => backend.observe(executionReceipt),
      cancel: ({ executionReceipt }) => backend.cancel(executionReceipt),
    }),
  ],
};
```

Clients, credentials, paths, and backend SDKs are captured by these functions. They never enter the
setup input or evidence digest.

## Type and schema boundary

The recommended authoring path uses a Draft 2020-12 JSON Schema as the single source of truth:

```ts
const importInputContract = defineJsonSchemaContract({
  schema: {
    $schema: JsonSchemaDialect.Draft202012,
    type: 'object',
    required: ['source'],
    properties: { source: { type: 'string' } },
    additionalProperties: false,
  } as const,
});
```

`defineJsonSchemaContract()` compiles the schema into the low-level `ExtensionValueContract`, infers
its TypeScript value type, and generates evidence from the canonical schema, dialect, and pinned
validator engine/version. An optional `resultData` contract applies the same rule to
Capability-specific success data. The fixed Workbench dispatch and terminal envelopes are always
validated separately.

Advanced hosts may directly provide one programmatic contract:

```ts
const customContract = defineExtensionValueContract<MyInput>({
  evidence: { contractId: 'research.custom-input', revision: '2026-08-15' },
  parse(input, path) {
    // Validate unknown and return a JSON-like MyInput.
  },
});
```

This is a low-level escape hatch, not a second configuration protocol. Workbench does not hash
JavaScript function source; the advanced host owns the accuracy of custom evidence.

## Resolution result

```ts
const setup = resolveWorkbenchSetup(setupInput, extensionResources);
```

Resolution uses temporary ID maps only while compiling the graph. Every resolved Profile slot then
holds:

```text
callable Initializer, Trainer, Exporter, or Output Invoker Capability Runtime
+ resolved Runtime Binding
  + callable Artifact Handoff Support Runtime
  + callable Execution Support Runtime
```

Workbench never receives the authoring resolver and does not re-resolve Profile slot selectors
during an operation. Creating a different Profile graph is an outer application concern: resolve
another setup, then create another Workbench instance. Each resolved Profile retains the Artifact
Handoff Supports reachable through its slots. A persisted `ArtifactReference` names its owning
Support directly, but Control Plane lookup remains inside the requested Profile scope.

A Profile may name one `canonicalOutputInvokerId`. Resolution rejects an explicit canonical ID that
does not reference an Output Invoker slot in that Profile. When the field is absent, a sole Output
Invoker is canonical automatically. A Profile with no Output Invoker or several non-canonical
Output Invokers remains valid, and its resolved canonical selection is unavailable; callers may
still use an explicit Output Invoker ID.

The official `createModelWorkbench()` application entry point performs these two calls and supplies
its documented defaults. Advanced hosts can keep both stages explicit when they need custom
persistence or ID generation.

Every public operation and asset query starts from a `profileId`. The optional outer setup field
`profile.infrastructure.persistence.configuration` is a JSON object passed unchanged to the
host-supplied `ProfilePersistenceAdapter`; it is routing configuration, not Model Profile domain
evidence or lineage. The adapter returns the narrow Run, parameter, Output, and committer ports for
that Profile. The default memory adapter creates an isolated composition per Profile, while a
custom adapter may route to separate SQLite files, schemas, databases, or remote stores.

During Initialization, Workbench first validates and persists the Capability-specific input and
frozen slot selection on a `starting` Run. It records dispatch, then the Capability either returns a
completed terminal result or accepts a detached execution and returns an opaque receipt. Workbench
stores that receipt on the Run. The public profile-scoped `runs.refresh()` and `runs.wait()` APIs ask
the bound Execution Support to observe it; an explicit `runs.cancel()` asks the same support to
cancel it. Both completion paths enter the same terminal handler. A successful result reports the
Artifact digest and its opaque handoff receipt.
Workbench then creates the Base and Artifact identities, combines them with the bound Support
identity, and asks that Support to verify the exact `ArtifactReference`. The terminal Run, Base, and
Artifact reference are committed together only after verification succeeds.

If persistence stops between dispatch and receipt acceptance, a subsequent `refresh()` re-drives the
`starting` Run with its original `profileId`, `runId`, validated input, and frozen slot. Durable
Capability bridges must use `profileId + runId` as an idempotent submission identity. Workbench owns
the Run timestamps; `terminalRecordedAt` records when Workbench observes and accepts the terminal
state, even if the backend actually finished while Workbench was offline.

Before Training, Workbench resolves every Base and ordered Modification in the selected Model
State. For each Artifact it selects the Support named by `artifact.handoff.runtimeSupportId` within
the current Profile, asks it
to verify the durable reference, and calls `materialize()`. The Support returns a transient,
JSON-like `binding` such as a local path or temporary remote URL. Workbench passes those bindings,
the exact Model State, and Capability-specific input through the fixed Trainer request envelope.
Durable handoff receipts remain distinct from transient materialized bindings.

Training then uses the same completed-or-accepted execution protocol as Initialization. A successful
Trainer result declares whether it produced a new Base or one additive Modification, plus the
Artifact digest and handoff receipt. Workbench assigns the Artifact and parameter-asset identities,
verifies the Artifact through the Trainer slot's bound Support, and atomically commits the terminal
Run with the produced asset. Both records preserve the exact ordered source Model State as lineage.

Export uses that same Model State materialization and execution lifecycle. A successful Exporter
reports a non-empty, uniquely named Artifact result set. Workbench assigns the Output and Artifact
identities, verifies every member through the Exporter slot's bound Artifact Handoff Support, and
atomically commits the terminal Export Run with the immutable Output. The Output records the exact
source Model State and frozen Exporter slot selection as lineage; exporting does not invoke or
publish it.

Output Invocation starts from an explicit Profile and Output identity. Workbench selects the
Profile's canonical Invoker unless an advanced caller supplies an explicit `outputInvokerId`, then
uses the same target resolver as the readiness operation. Each Artifact's owning Handoff Support
verifies it once and materializes a transient binding while preserving the exact Output identity in
the Capability request. The Invoker returns either one completed result or an AsyncIterable stream;
both forms carry the selected target evidence before stream consumption begins. Its output Contract
validates the completed result or each stream chunk lazily. Invocation is intentionally outside the
durable execution lifecycle: it creates no Run, model asset, or managed Session. Workbench forwards
the caller's `AbortSignal`, while the Output Invoker remains responsible for cooperative cancellation
throughout the lifetime of any returned stream.

The separate `outputInvocations.resolve({ profileId, outputId })` readiness operation selects the
canonical Invoker and performs only exact Output identity, Profile ownership, Support availability,
and Artifact verification checks. Its evidence digest covers the immutable Output, the selected
Invoker slot, and the exact Artifact Handoff Support evidence used to verify every Artifact. It does
not cover the whole Workbench setup. Resolution never materializes an Artifact or calls the Invoker,
so success means that Workbench's declared target is currently resolvable—not that future inference
I/O is guaranteed to succeed.

The executable version of this example lives in
`tests/integration/test/extension-runtime-resolution.test.ts`.

A larger inline fixture demonstrating several Profiles, shared Capabilities, shared Runtime
Bindings, and Runtime Support reuse lives in
`tests/integration/test/fixtures/multi-profile-extension-setup.ts`; its identity-level
resolution assertions live in `tests/integration/test/multi-profile-extension-reuse.test.ts`.

The complete outer-resolution to governed-operation example lives in
`tests/integration/test/resolved-workbench-composition.test.ts`.

The fixed request and result semantics for all Model Capability kinds are summarized in
[Model Capability Contracts](./model-capability-contracts.md).
