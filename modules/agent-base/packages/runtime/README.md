# `@print-an-agent/base-runtime`

Agent execution ownership over the independent `@print-an-agent/workflow-core` package.

- `Agent` owns typed Operations, invocation permissions, cycle detection, parent/child Run
  correlation and Operation executor drainage.
- `bindAgentWorkflow` binds an assembled Core Workflow to an Agent Run, adding tracing and explicit
  result application. The Workflow already holds its borrowed resources; the binding has no resource
  resolver and does not execute Steps or own resources.
- `AgentWorkflowRun.applyTo` accepts only the originating Run Context.
- Workflow Catalogs and optional configuration registries organize exact binding references.

Import `Workflow`, Step types, registries, overrides, signal composition and timeout helpers directly
from `@print-an-agent/workflow-core`. Agent Base does not re-export or duplicate that execution kernel.

```ts
const bound = bindAgentWorkflow({
  workflow, // RunnableWorkflow<MyAgentRunContext, MyResult>; ports bound at construction
  applyResult(context, result) {
    // Product-owned interpretation. An explicit no-change result leaves prior output alone.
    if (result !== undefined) context.output = result;
  },
});
// Supply bound in defineAgentOperation({ ... , workflowPlan: [bound] }).
```

Inside a bound Workflow, `input` is the Agent Run Context, `state` is per-run business data,
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

Conditions return the Core Workflow's initial result when skipped. Consumers decide how that value
is applied. Official Request and compaction bindings use `undefined` for no change and validate a
normal completed execution has produced a result. Skipping cannot erase an existing Agent output.
