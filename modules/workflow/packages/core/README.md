# @print-an-agent/workflow-core

A domain-independent execution core: reusable Workflow definitions, replaceable named Steps,
run-local state/results, cooperative cancellation, and joined parallel execution. No runtime package
dependencies.

```ts
import { Workflow } from '@print-an-agent/workflow-core';

const sum = new Workflow<'sum', readonly number[], void, void, number>({
  name: 'sum',
  resources: undefined,
  entryStep: 'sum',
  createState: () => undefined,
  createResult: () => 0,
  stepDefinitions: {
    sum: {
      skippable: false,
      cardinality: 'at-most-once',
      step: (context) => {
        context.result = context.input.reduce((a, b) => a + b, 0);
        return Promise.resolve();
      },
    },
  },
});

const result = await sum.run({ input: [1, 2, 3] }); // 6
```

The five generic parameters are Step names, input, local state, bound resources, and result.
Resources are provided alongside Steps at construction; every run borrows the same capability
references through `context.resources`. `run()` accepts input and execution options, with no Resources
override. `RunnableWorkflow<Input, Result>` describes the already-assembled callable.
`createState` / `createResult` create data, not connections. A Step returns `Promise<void>` and updates
`context.state` or `context.result`; `run()` returns the typed result directly. Primitive and void
results work too. A skipped Workflow returns the truthful initial result without creating state or
running hooks. Use a consumer-defined union when a value may not have been produced.

`await context.runStep(name)` dispatches through the resolved registry and executor. To acquire
parallel child results safely, use `await context.parallel(['readA', 'readB'])`: it cancels peers on
failure and waits for all children before rejecting. It does not serialize the Steps. Distinct names
may run together; the same name cannot overlap, even with repeatable cardinality. Children still share
business state: consumers must design concurrent writes safely (for example, write separate fields).

Registered unfinished work is cancelled and drained before hooks or return. A successful body that
leaves registered children pending is a locked protocol failure, not implicit fire-and-forget support.
Unregistered work and non-cooperative promises cannot be forcibly stopped. Resource owners must await
their child group before releasing resources; bound shared adapters remain borrowed.

Read the [usage guide](../../docs/usage.md) and [full execution contract](../../docs/execution-contract.md). The
[file report consumer](./test/consumers/text-report.ts) and its real-filesystem test demonstrate a
non-Agent integration through only public exports.

Run `pnpm test:workflow-qualification` from the repository root.
