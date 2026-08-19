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
callable Initializer or Trainer Capability Runtime
+ resolved Runtime Binding
  + callable Artifact Handoff Support Runtime
  + callable Execution Support Runtime
```

Workbench never receives the authoring resolver and does not re-resolve Profile slot selectors
during an operation. Creating a different Profile graph is an outer application concern: resolve
another setup, then create another Workbench instance. The resolved setup separately retains the
Artifact Handoff Supports supplied by the host because a persisted `ArtifactReference` names its
owning Support directly; this permits one Model State to contain local and remote Artifacts without
scanning current Profile bindings.

The official `createModelWorkbench()` application entry point performs these two calls and supplies
its documented defaults. Advanced hosts can keep both stages explicit when they need custom
persistence or ID generation.

During Initialization, the Capability either returns a completed terminal result or accepts a
detached execution and returns an opaque receipt. Workbench stores that receipt on the Run. The
public `runs.refresh()` and `runs.wait()` APIs ask the bound Execution Support to observe it; an
explicit `runs.cancel()` asks the same support to cancel it. Both completion paths enter the same
terminal handler. A successful result reports the Artifact digest and its opaque handoff receipt.
Workbench then creates the Base and Artifact identities, combines them with the bound Support
identity, and asks that Support to verify the exact `ArtifactReference`. The terminal Run, Base, and
Artifact reference are committed together only after verification succeeds.

Before Training, Workbench resolves every Base and ordered Modification in the selected Model
State. For each Artifact it selects the Support named by `artifact.handoff.runtimeSupportId`, asks it
to verify the durable reference, and calls `materialize()`. The Support returns a transient,
JSON-like `binding` such as a local path or temporary remote URL. Workbench passes those bindings,
the exact Model State, and Capability-specific input through the fixed Trainer request envelope.
Durable handoff receipts remain distinct from transient materialized bindings.

Training then uses the same completed-or-accepted execution protocol as Initialization. A successful
Trainer result declares whether it produced a new Base or one additive Modification, plus the
Artifact digest and handoff receipt. Workbench assigns the Artifact and parameter-asset identities,
verifies the Artifact through the Trainer slot's bound Support, and atomically commits the terminal
Run with the produced asset. Both records preserve the exact ordered source Model State as lineage.

The executable version of this example lives in
`tests/integration/test/extension-runtime-resolution.test.ts`.

A larger inline fixture demonstrating several Profiles, shared Capabilities, shared Runtime
Bindings, and Runtime Support reuse lives in
`tests/integration/test/fixtures/multi-profile-extension-setup.ts`; its identity-level
resolution assertions live in `tests/integration/test/multi-profile-extension-reuse.test.ts`.

The complete outer-resolution to governed-operation example lives in
`tests/integration/test/resolved-workbench-composition.test.ts`.
