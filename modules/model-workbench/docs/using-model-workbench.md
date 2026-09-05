# Using Model Workbench

Model Workbench has two host-owned inputs and one dynamic output boundary:

```text
static JSON-like setup
+ live Model Capability and Runtime Support resources
+ Profile-scoped persistence adapter
  -> createModelWorkbench()
  -> Runs, parameter assets, Outputs, and lineage
```

The setup and live resources are ordinary application code. Workbench does not register, version,
or persist them. A host can reuse one Capability or Runtime Support in multiple Profile slots while
each slot selects one concrete Capability and one Runtime Binding.

The integration fixture
[`public-local-workbench.ts`](../tests/integration/test/fixtures/public-local-workbench.ts) is a
standalone consumer of public package entry points. It demonstrates:

- Initializer, Trainer, Exporter, and Output Invoker Capability construction;
- shared local Artifact and execution Runtime Supports;
- profile-routed SQLite persistence;
- the detached local command bridge for producing operations;
- the attached streaming bridge for Output Invocation.

The corresponding `local-product-lifecycle.test.ts` runs the complete deterministic lifecycle with
a Python-standard-library backend. It creates no network traffic, downloads no model, uses no GPU,
and writes only tiny JSON Artifacts. Python is a test dependency for that fixture, not a dependency
of the published TypeScript packages.

## Discovery

Every durable query begins with `profileId`:

```ts
await workbench.runs.list({
  profileId: 'research-model',
  status: 'running',
  limit: 25,
});

await workbench.models.listBases({ profileId: 'research-model' });
await workbench.models.listModifications({ profileId: 'research-model' });
await workbench.outputs.list({ profileId: 'research-model' });
```

Pass the returned `nextCursor` as `cursor` to continue. Ordering is stable by Workbench identity.
Asset records already contain their exact operation lineage and source Model State.

## CLI

`@ta-agent/workbench-cli` is deliberately not a configuration system. It loads a host-supplied
JavaScript module:

```js
export async function createWorkbench() {
  return workbench;
}

export async function close() {
  await persistence.close();
}
```

Each command accepts one bounded JSON document whose shape is the corresponding public API input:

```sh
model-workbench training start \
  --application ./workbench.mjs \
  --request ./start-training.json

model-workbench run wait \
  --application ./workbench.mjs \
  --request ./wait-for-run.json
```

The CLI exposes initialization, training, export, Output Invocation, Run control and discovery,
asset discovery, and dynamic Model State composition. A completed invocation prints one JSON line;
a streaming invocation first prints its target-evidence envelope, then one `chunk` JSON line per
result.

Application integrations should use `classifyModelWorkbenchError(error)` when they need a stable
policy decision. The classifier distinguishes invalid input, unavailable targets, governed
operation failures, Output Invocation failures, caller cancellation, persistence/integrity
failures, and unexpected failures. It preserves a concrete Workbench code when available; it does
not wrap, replace, persist, or infer retry behavior for the original error.

## Deliberate boundaries

This delivery does not provide an official model backend, managed serving Session, Release or
promotion authority, retention policy, configuration registry, metrics store, or distributed job
scheduler. Those capabilities can be added around the stable public SPI and persistence boundaries
without making them prerequisites for local model experimentation.
