# `@ta-agent/base-workflow`

Agent orchestration, conditional Workflows, run-scoped Contexts, and replaceable Steps for Agent
Base.

The runtime has five execution levels:

```text
Agent
  → Agent Operation
      → Agent Run
          → Workflow
              → Step
```

An Agent is the sole owner of identity, global resources, an immutable Workflow Catalog, and a typed
Agent Operation Catalog. An Agent Operation is a static named capability definition with public or
internal exposure, typed input/output, local config/resources, a Context factory, an ordered
Workflow plan, and an explicit set of callable Operation references. Every `agent.invoke()` creates
one isolated Agent Run and `BaseAgentRunContext`. The runtime records Agent Run, Workflow, and nested
Step lifecycle metadata through `@ta-agent/base-observability` without exposing Context values.

A Workflow is a reusable class with its own condition, Workflow Context factory, Step Registry, and
Step Executor. Every Workflow run creates an isolated Workflow Context. Leaf, composite, and entry
workflow Steps all have the same function shape and resolve nested calls through
`context.runStep()`.

Every Step definition declares `cardinality: STEP_CARDINALITY.AT_MOST_ONCE` or
`STEP_CARDINALITY.REPEATABLE`. Cardinality limits logical `runStep()` invocations of one registered
name within one Workflow Run, independently of parent Steps and function identity. Each Run owns its
state; definitions remain reusable. Both policies reject overlapping or recursive calls of the same
name with `STEP_CONCURRENT_INVOCATION_NOT_ALLOWED`. After completion, failure, or skip, another
`AT_MOST_ONCE` call fails with `STEP_CARDINALITY_EXCEEDED`; a `REPEATABLE` call is allowed.

Reservation happens before asynchronous execution or tracing. Rejected calls do not enter the Step
Executor or emit execution lifecycle events. Accepted active calls emit one started and one
completed/failed event; accepted skips emit one skipped event and consume an invocation. Different
Steps still share the mutable Workflow Context, so this is not a Workflow-wide concurrency lock.

Function overrides inherit the registered policy. Structured overrides can change the implementation,
cardinality, or both; omitted fields inherit their existing values:

```ts
const stepOverrides = {
  loadSession: customLoadSession,
  processItem: { cardinality: STEP_CARDINALITY.REPEATABLE },
  publishProgress: { step: SKIP_STEP, cardinality: STEP_CARDINALITY.REPEATABLE },
};
```

`SKIP_STEP` is permitted only for definitions with `skippable: true`. Registry resolution validates
and freezes the effective definitions, including skipped Steps. `mergeStepOverrides(defaults,
overrides)` merges supplied fields across composition layers, so a policy-only override retains an
installed default implementation or skip instead of reverting to a placeholder.

Cardinality does not implement retry, idempotency, or rollback. A custom executor or implementation
may perform multiple attempts inside one invocation, with only one Step lifecycle. For a `REPEATABLE`
Step, calling `runStep()` again after terminal failure starts a new invocation. For an `AT_MOST_ONCE`
Step, that call is rejected with `STEP_CARDINALITY_EXCEEDED` and no new invocation begins.
Composite attempts never reset child invocation state. There is no built-in retry or attempt counter.
A future Workflow retry must create a new Workflow Run; this resets invocation state but cannot undo
earlier business side effects.

An active Workflow may skip itself through its internal condition. Step and Workflow registry
utilities remain available to composition code that needs validated override/skip resolution, but
the Agent-owned Workflow Catalog contains only concrete immutable Workflow definitions. Operations
reference those definitions directly, and the Agent rejects different definitions that reuse one
Workflow name.

```ts
const chat = new Workflow({
  name: 'chat',
  entryStep: 'workflow',
  stepDefinitions,
  createContext: (base) => ({ ...base, messages: [] }),
  condition: () => Promise.resolve(RUN_WORKFLOW),
  applyResult: async (agentRunContext, result) => {
    agentRunContext.output = result;
  },
});

const foreground = defineAgentOperation({
  name: 'foreground',
  exposure: 'public',
  workflowPlan: [chat],
  config,
  resources,
  createContext: (base) => ({ ...base, messages: [] }),
});

const agent = createAgent({
  identity: defineAgentIdentity({ id: 'example', displayName: 'Example' }),
  resources,
  operations: { foreground },
});

const response = await agent.invoke('foreground', input);
```

Operation-to-Operation visibility is deny-by-default. `defineAgentOperationReference()` supports
forward declarations; an Operation receives only the narrowed invoker described by its
`callableOperations`. Child calls create distinct correlated Runs, always retain inherited
cancellation, may add a narrower local source, and fail closed on undeclared targets or invocation
cycles.

An Operation may also own bounded `prepareRun`, `executeRun`, and `mapRunError` policies.
Preparation validates or normalizes input before Context creation, returns one closed input-only
result, and observes but never replaces the effective execution signal. The optional Run Executor
is the only execution-boundary extension point and is analogous to a Step Executor: it must invoke
and await the supplied `execute(signal)` exactly once, cannot replace the authoritative Run output
or swallow its failure, and may add a narrower local cancellation source. The runtime composes the
original parent,
executor-supplied, and runtime-owned containment sources into one effective downstream
`AbortSignal`. No source is aborted in reverse. An omitted, overlapping, repeated, or unawaited
execution locks a stable protocol failure, cancels and drains the active Run, and remains the
authoritative terminal outcome even when an earlier cancellation reason won the effective signal.
Catching the rejected `execute()` Promise cannot restore success. Error mapping establishes the
public terminal failure contract. These hooks are part of the Operation lifecycle, so raw
`agent.invoke()` remains behavior-complete without an application facade.

`runWithExecutionTimeout()` is the provided thin deadline primitive. `null`, also exported as
`NO_EXECUTION_TIMEOUT`, adds no timer and forwards the parent `AbortSignal` unchanged. A positive
integer creates one child cancellation domain: parent cancellation propagates down, local expiry
aborts actual work with the standard `TimeoutError` reason, and the owner receives a branded
`EXECUTION_TIMEOUT` failure detectable through `isExecutionTimeoutFailure()`. The helper clears its
timer and owned effective-signal listener in `finally`. A boundary may instead supply
`createTimeoutFailure` to map only that invocation's deadline directly into its own domain error;
consumers must not reinterpret an arbitrary nested `EXECUTION_TIMEOUT` as their own. Cancellation
remains cooperative: the supplied operation must observe its signal and settle; the helper does not
abandon unowned background work through a bare `Promise.race()`.

`createWorkflow()` and `createAgent()` are constructor conveniences. Subclassing is not required,
but classes remain available when a product benefits from a named domain type.

Tracing is fail-open: an observability sink cannot replace an execution result or failure. This
package contains no provider, Pi, database, configuration schema, or product policy.
