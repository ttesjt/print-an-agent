# Model Workbench CLI

This is a thin client for an already assembled Model Workbench. It does not load or manage
Profile, Capability, Runtime Support, or Binding configuration.

Pass a JavaScript module that exports `createWorkbench()` and, optionally, `close()`:

```js
export async function createWorkbench() {
  return workbench;
}

export async function close() {
  await persistence.close();
}
```

Every command reads its public API request from a bounded JSON file. For example:

```sh
model-workbench run list \
  --application ./workbench.mjs \
  --request ./list-runs.json
```

Output Invocation emits one JSON line for a completed result, or one `chunk` JSON line for every
streamed result. Use `model-workbench --help` for the complete command list.
