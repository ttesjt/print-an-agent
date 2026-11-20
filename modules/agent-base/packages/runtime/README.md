# `@print-an-agent/base-runtime`

Agent execution ownership over the independent `@print-an-agent/workflow-core` package.

- `Agent` owns typed Operations, invocation permissions, cycle detection, parent/child Run
  correlation and Operation executor drainage.
- `bindAgentWorkflow` binds an assembled Core Workflow to an Agent Run, adding tracing and explicit
  input projection and result application. The Workflow already holds its borrowed resources; the
  binding has no resource resolver and does not execute Steps or own resources.
- `AgentWorkflowRun.applyTo` accepts only the originating Run Context.
- Workflow Catalogs and optional configuration registries organize exact binding references.

## Source ownership

```text
src/
  agent/       The one raw Agent owner, registration and public invocation
  operations/  Operation definitions, exact references and type inference
  runs/        Run lifecycle, plan execution, narrowed child calls and executor protocol
  workflows/   Core bindings, synchronous input projection, tracing, Catalog and Registry
  types/       Shared Run Context and invocation contracts only
  errors.ts    The canonical runtime Definition and Run error classes
```

The Agent retains its immutable identity, borrowed resource references and instance-owned
registration tables. Registration gathers exact Workflow bindings and validates Operation keys,
reference identities and callable targets before a Run can begin. Keeping this composition in
`agent/` lets the Workflow Catalog remain independent from Operation definitions.

Run execution borrows identity, trace options and a narrow reference lookup from that owner. It
creates isolated input/signal state, lineage, Context, trace emitter and executor protocol for each
invocation. Preparation, terminal error mapping and ordered result application retain their original
boundaries. Extracting these modules adds no second Agent owner, resource lifecycle or execution
kernel. The executor protocol keeps cancellation, authoritative failure selection and actual
execution drainage in one state machine.

Dependencies flow from Agent assembly to Run execution, Operation definitions and Workflow bindings.
The shared `types/` contracts do not import these implementations. Each feature exposes a deliberate
`index.ts`; callers do not enter sibling private files or import through their own aggregate.
Independent types belong to their feature's `types.ts` or `types/`. Runtime classes stay with their
runtime owner, and `SkipWorkflow` stays next to its authoritative `SKIP_WORKFLOW` symbol.

The package keeps its single public entry and existing type/value distinction. In particular,
`AgentOperationReference` is exported as a type; `defineAgentOperationReference()` is its public
construction API. Runtime errors retain one constructor identity across features.

Unit tests follow registration, invocation, Run preparation, executor completion/cancellation,
child permissions/cancellation and Context isolation. Workflow binding and registry tests live
under `test/unit/workflows`; compile-only contracts live in `test/types`. Repository-level
`test/runtime-architecture.test.ts` checks feature entries, allowed dependency direction including
types and erased type modules, using the shared source-boundary checker. The existing Workflow
architecture checks retain the Runtime/Core separation. Runtime ownership and drainage still need
behavior tests and review; static imports alone cannot prove those properties.

Import `Workflow`, Step types, registries, overrides, signal composition and timeout helpers directly
from `@print-an-agent/workflow-core`. Agent Base does not re-export or duplicate that execution kernel.

```ts
const bound = bindAgentWorkflow({
  workflow, // RunnableWorkflow<{ message: string }, MyResult>; ports bound at construction
  projectInput: (context: MyAgentRunContext) => ({ message: context.input }),
  applyResult(context, result) {
    // Product-owned interpretation. An explicit no-change result leaves prior output alone.
    if (result !== undefined) context.output = result;
  },
});
// Supply bound in defineAgentOperation({ ... , workflowPlan: [bound] }).
```

`projectInput` is required and defined when assembling the binding. It synchronously selects the
input for each invocation, before the Workflow's condition or state creation. The Workflow's declared
input type determines what the projection must return; it need not extend an Agent Run Context.
The same projected value reaches `condition`, `createState`, and `createSkippedResult` as applicable.
A projection failure is propagated unchanged before Workflow admission; no Workflow hooks or result
application run for that failure. Missing or non-callable projectors fail at binding construction
with `WORKFLOW_INPUT_PROJECTION_INVALID`.

The synchronous boundary is also enforced at runtime, including when the Workflow accepts `unknown`
or another broad input type. A top-level Promise or callable thenable fails before admission with
`WORKFLOW_INPUT_PROJECTION_ASYNC`; it cannot produce a successful Workflow or result application.
Native Promise rejections are observed immediately using a realm-independent brand check and the
Promise intrinsic. Pending Promises are rejected without waiting for settlement. Custom thenable
methods are not called; ordinary values, callable data, and non-callable `then` fields remain valid.
Async work started by an invalid projection is not cancelled by this check; keep I/O in an execution
boundary that receives cancellation and owns its cleanup.

Keep projections free of I/O; business validation and execution belong to the Workflow or Operation.
Projection is a binding function, not a registered Step or a resource factory. The binding always
supplies the source Run's signal, parent correlation, and trace observer as separate execution
parameters, and `applyResult` receives the original Run. Projected data cannot replace these
execution parameters. Consumers may deliberately use `projectInput: (run: MyAgentRunContext) => run`
when their Workflow needs that full input.

Each Workflow's `createState` prepares the business data exposed to Steps through `context.state`.
Official Request and compaction bindings select business input and invocation-local metadata;
neither Workflow retains an Agent Run. Their Agent Run types and result application belong to
composition.
`resources` contains capabilities bound when constructing the Workflow and `result` is a
consumer-defined value. Those dependencies are shared across runs; mutable state, output, trace
emitters and execution leases remain per-run. Core assembles the execution fields.
Use the effective Step `signal` for adapters and pass it explicitly when a
child Operation must inherit a Step/parallel-group cancellation scope.

`createWorkflowTraceObserver` maps frozen Core metadata into the existing Agent trace vocabulary;
the binding supplies safe failure classification using `traceErrorCode`. Recovered Step failures
remain observable. Core never awaits observer delivery. The trace emitter owns ordering and delivery,
and Agent Operation terminal recording follows earlier Workflow records.
All Workflow terminals, including skipped Runs, retain the started event's `workflowRunId`.

On a condition skip, Core returns the value of `createSkippedResult`. Consumers decide how that value
is applied. Official Request and compaction bindings use `undefined` for no change and validate a
normal completed execution has produced a result. Skipping cannot erase an existing Agent output.
