# @print-an-agent/workflow-core

A domain-independent execution core: reusable Workflow definitions, replaceable named Steps,
run-local state, typed results, cooperative cancellation, and joined parallel execution. No runtime package
dependencies.

The package has two public entries:

- `@print-an-agent/workflow-core`: Workflow execution, Step composition, execution signals and timeouts,
  and their public contracts.
- `@print-an-agent/workflow-core/bundle`: `WorkflowBundle`, `WorkflowBundleDefinitionError`, and the
  `BundleWorkflowDefinition`, `BundleWorkflows`, `WorkflowBundleOptions` and
  `WorkflowBundleDefinitionErrorCode` types. See the [Bundle guide](./docs/bundle.md).

Bundle members are ordinary Core Workflows. Bundle-specific exports belong to the `/bundle` subentry;
the root entry retains its existing API. No other package subpaths are public.

Internally, Bundle reuses the existing shared Core `src/workflow.ts` capability and
`src/types/workflow.ts` contracts directly. It does not import through the root aggregate entry;
execution code remains independent of Bundle assembly.

```ts
import { Workflow } from '@print-an-agent/workflow-core';

type SumInput = { readonly values: readonly number[]; readonly label: string };
type SumState = { readonly values: readonly number[]; total: number };
const sum = new Workflow<'sum', SumInput, SumState, void, number>({
  name: 'sum',
  resources: undefined,
  entryStep: 'sum',
  createState: ({ input }) => ({ values: input.values, total: 0 }),
  createResult: ({ total }) => total,
  stepDefinitions: {
    sum: {
      skippable: false,
      cardinality: 'at-most-once',
      step: (context) => {
        context.state.total = context.state.values.reduce((a, b) => a + b, 0);
        return Promise.resolve();
      },
    },
  },
});

const result = await sum.run({ input: { values: [1, 2, 3], label: 'example' } }); // 6
```

The five generic parameters are Step names, input, local state, bound resources, and result.
`WorkflowContext<StepName, State, Resources>` exposes the state returned by `createState`.
The factory selects, transforms or consumes input to prepare the data Steps need, leaving replaceable
business execution in the Steps. State may have any shape, including a primitive or `void`.
Input is available to `run`, conditions, state creation and skip result creation. Steps, executors
and lifecycle hooks access business data through `context.state`.
Resources are provided alongside Steps at construction; every run borrows the same capability
references through `context.resources`. `run()` accepts input and execution options, with no Resources
override. `RunnableWorkflow<Input, Result>` describes the already-assembled callable.
A Step returns `Promise<void>` and records its business data in `context.state`. The synchronous
`createResult(state)` projects the typed return value after Steps and `onSuccess`, and `run()` waits
for `onFinally` before returning it. Primitive and void results work too. A condition skip calls
`createSkippedResult({ input, reason })` without creating state or running hooks.

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
