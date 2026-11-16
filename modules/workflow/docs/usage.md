# Using Workflow Core

Use `@print-an-agent/workflow-core`, never a source deep import. There is one execution package, no generic
application/resource framework. Each consuming domain supplies its own ports and types.
For a group of Workflows sharing Resources, use
[`@print-an-agent/workflow-bundle`](../packages/bundle/README.md). It constructs ordinary Core Workflows
from unbound definitions and adds no execution layer.

## Defining a flow

The [package quick start](../packages/core/README.md) shows a complete scalar example. The first
[consumer](../packages/core/test/consumers/text-report.ts) reads and writes text through `TextFiles`.
The independent [second consumer](../tests/qualification/test/consumers/record-update.ts) loads data
and policy concurrently, validates, then updates a record through a CAS-owning `RecordStore` port.
Neither knows about Agents or Memory.

Use named Steps for replaceable behavior. Composite Steps call `context.runStep(name)`, rather than
capturing a leaf function directly, so overrides apply throughout the graph. `createSequentialStep`
provides ordered composition. The entry Step is replaceable too; it cannot be configured as skipped.

Each definition declares `skippable` and `cardinality`. Overrides can supply a function, `SKIP_STEP`,
or `{step?, cardinality?}`. `mergeStepOverrides` applies layers by supplied fields; omitted fields keep
earlier values. Registries are frozen snapshots of plain own data properties, not live config views.
Getters, extra policy fields, unknown override names and undeclared cardinality are rejected.

At-most-once applies to a registered name within one run, including failed and skipped calls.
Repeatable permits serial reuse but not overlap or recursion. A repeatable parent does not reset
its children's counts. These are execution policies, **not durable idempotency or exactly-once I/O**.

## Data and result ownership

Provide `resources` in the Workflow definition, alongside Step configuration. Each assembled Workflow
keeps that binding for its lifetime. For example, construct `textReport(files)` or `recordUpdate(ports)`
once, then call it with different inputs. To use a different store, assemble a separate Workflow with
that store. A resource-free Workflow explicitly binds `resources: undefined`.

Call `workflow.run({input, signal?, parentRunId?, onEvent?, classifyFailure?})`. Core creates execution
fields; the caller cannot supply a runner or replace signal/run identity. `WorkflowRunOptions<Input>`
has no Resources parameter, and `RunnableWorkflow<Input, Result>` represents the already-assembled
callable. Conditions, state creation, executors, Steps and hooks receive bound resources.

Use `createState({ input, resources })` to prepare all business data needed by Steps and hooks.
Each Workflow defines its own state shape and may transform or consume input during initialization.
`WorkflowContext<StepName, State, Resources>` exposes that state through `context.state`.

The resources/state references are read-only, but not deep-frozen. Resources keep their original
object identity and class methods. Replacing `definition.resources` after construction does not rebind
an assembled Workflow. Mutable adapter contents are still live; Core does not snapshot database data
or freeze borrowed capabilities. Each run should construct its own mutable state.
Parallel runs share dependencies and keep independent execution state, cancellation and observation.
Shared ports or closures need their own concurrency guarantees.

All context views for a run share state. Use Step writes to record intermediate data, completed
work and any commit evidence your domain needs. `createResult(state)` projects the final value after
Steps and `onSuccess`. For example, the record updater projects an outcome from the updated record
in state, without returning the loaded record or validation limits. `onFinally` runs before the
caller receives the value. Core never applies it to external authority.

If a condition can skip, supply a separate projection. A consumer can declare a union for the
normal and skipped outcomes:

```ts
type Result = { status: 'skipped'; reason: string } | { status: 'saved'; revision: number };
```

`createSkippedResult({ input, reason })` can return the skipped variant. It runs before state would
be initialized, so it uses the condition's reason and original input. Condition, state creation,
Step, projection and cleanup errors reject the call. Host code decides when to apply a result.

## Parallel work and cancellation

```ts
try {
  await context.parallel(['readRecord', 'readPolicy']);
} finally {
  // This resource owner's release belongs here only if the children use its owned lease.
  // The awaited parallel call has joined every child, even on failure/cancellation.
}
```

The helper invokes named Steps through the normal registry and executor. First observed failure
cancels the group, but not the parent. Nested groups inherit their effective signal. Distinct failures
are retained; AggregateError has the primary failure as `cause`. A parent may deliberately handle an
ordinary child error and continue. No cancellation handler is allowed to masquerade as a new run.

Each Step/implementation attempt receives a scope-bound view. Never assume reference equality of
parent, executor and child contexts or signals. Pass **the context supplied to the current Step's
body** to adapters; closing-over a parent signal bypasses group-local cancellation. Business data is
shared across those views, so parallel writers should use independent fields or domain-owned locking.

Calling raw `Promise.all` is allowed, but it rejects early: if that parent's `finally` closes a resource
used by another child, outer Workflow drain cannot undo the early close. Prefer `parallel` for that
scope. Returning successfully while registered work is pending is a protocol error, not an implicit
join. Core cancels and drains it before returning failure. All retained runners reject late calls.

Tracking observes actual execution; it cannot inspect whether settled promises were syntactically
awaited, or track timers/fetches/promises started outside `runStep`/`parallel`. Deliberately detached work
remains the caller's responsibility. Cancellation is cooperative: a registered promise ignoring its
signal keeps drain waiting. We never claim it stopped or release resources based on a timer race.

## Resources, hooks and errors

Factories only construct data and references. Binding a capability does not acquire a connection or
transfer ownership. A bound adapter may manage a pool or acquire per-operation transactions/leases.
A Step acquiring its own lease must await its users before releasing it. Shared bound resources remain
borrowed; Core never calls their `close()` methods, including on failure, skip or cancellation.

When an external owner acquires resources, protect assembly and every invocation using them with that
owner's cleanup boundary, including construction/factory failures. Release shared resources after all
their Workflow runs have settled. If execution and release both fail, the owner must preserve both
errors rather than allowing a JavaScript `finally` throw to overwrite the first.

After execution admission closes and tracked work settles, Core calls `onSuccess` before projection.
An execution, success-hook or projection failure goes to `onError`. `onFinally` follows either path.
Hook failures are retained alongside execution failures. A state factory/condition failure or
condition skip has no constructed context, so these hooks do not run. Hooks cannot start new Steps.
`onFinally` does not grant resource ownership. It is also not transaction rollback: if a port committed
before a later failure, the commit still happened. Product services own truthful committed outcomes.

Custom executors may serially retry the supplied implementation. They must invoke it at least once,
pass their supplied context, and await every attempt. Core checks actual body completion before
executor post-processing, closes the attempt's child scope, and then permits the next attempt. A
recovered business failure is allowed; catching a framework protocol violation cannot restore success.

## Observability and explicit deadlines

`onEvent` receives frozen Workflow/Step identifiers and event kind, plus consumer-authored skip reasons
and optionally a classified failure code.
No business payloads or raw errors are included. Consumers may use `parentRunId` and an observer
closure to add host correlation. Keep identifiers/reasons free of secrets.
Callbacks are invoked in order, but promises are not awaited; synchronous/asynchronous failures are
isolated. Observers own buffering and flush. A stalled observer cannot block resource cleanup.

For safe failure diagnostics, supply a synchronous classifier for each run:

```ts
await workflow.run({
  input,
  classifyFailure: (error) => (error instanceof SyntaxError ? 'INPUT_INVALID' : undefined),
  onEvent: (event) => {
    if (event.type === 'step-failed' || event.type === 'workflow-failed') {
      recordDiagnostic(event); // Includes an optional errorCode, never the raw exception.
    }
  },
});
```

The classifier sees the actual error even when a parent Step catches it and recovers. A terminal
Workflow failure is classified separately, including aggregated execution/cleanup errors. The callback
does not change the error thrown to the caller. Only codes matching `[A-Z][A-Z0-9_]{0,127}` are accepted;
invalid or missing codes are omitted, not coerced or truncated. A throwing or accidentally async
classifier cannot replace the failure or delay cleanup; its asynchronous return is ignored, with
rejection observed. Without `onEvent`, classification does not run. Choose codes from a safe public
vocabulary rather than copying error messages, provider responses or arbitrary exception fields.

Workflow adds no model/request timeout. `runWithExecutionTimeout` is an explicit helper: `null` disables
the timer and forwards the parent signal unchanged. A configured deadline cancels actual downstream
work and waits for settlement; it does not forcibly terminate it. Only that boundary's own timeout is
mapped to its timeout failure. Parent cancellation stays parent cancellation. Outside an explicitly
enabled timeout, a successfully returned committed operation is not reclassified due to a late abort.

## Testing

Run `pnpm test:workflow-qualification`; it builds Core and Bundle, compiles their consumers (including
negative type fixtures), lints/formats, executes standalone and Bundle lifecycle regressions, and checks public
dependency/declaration boundaries. For a clean rebuild first run `pnpm --filter @print-an-agent/workflow-core clean`.
