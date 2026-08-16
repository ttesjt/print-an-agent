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
      supports: { artifactVerifierId: 'artifacts.local' },
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
      initialize: async ({ input, plannedArtifactId }) => {
        await modelBackend.import(input.source);
        return {
          status: 'succeeded',
          artifact: {
            artifactId: plannedArtifactId,
            digest: await modelBackend.digest(),
          },
        };
      },
    }),
  ],
  runtimeSupports: [
    defineArtifactVerifierSupport({
      runtimeSupportId: 'artifacts.local',
      verify: ({ artifact }) => localArtifacts.verify(artifact),
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
Capability-specific success data. The fixed Workbench success/failure envelope is always validated
separately.

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
callable Initializer Capability Runtime
+ resolved Runtime Binding
  + callable Artifact Verifier Support Runtime
```

Workbench never receives a resolver or registry and never looks these IDs up during an operation.
Creating a different graph is an outer application concern: resolve another setup, then create
another Workbench instance.

The official `createModelWorkbench()` application entry point performs these two calls and supplies
its documented defaults. Advanced hosts can keep both stages explicit when they need custom
persistence or ID generation.

During Initialization, Workbench calls the resolved Initializer Capability first. A successful
Artifact candidate is then passed to the Artifact Verifier Support from the same slot's Runtime
Binding. Workbench accepts the Base only after verification succeeds.

The executable version of this example lives in
`tests/integration/test/extension-runtime-resolution.test.ts`.

A larger inline fixture demonstrating several Profiles, shared Capabilities, shared Runtime
Bindings, and Runtime Support reuse lives in
`tests/integration/test/fixtures/multi-profile-extension-setup.ts`; its identity-level
resolution assertions live in `tests/integration/test/multi-profile-extension-reuse.test.ts`.

The complete outer-resolution to governed-operation example lives in
`tests/integration/test/resolved-workbench-composition.test.ts`.
