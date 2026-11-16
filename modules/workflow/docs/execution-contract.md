# Workflow Core execution contract

Execution semantics, customization boundaries and resource ownership for `@print-an-agent/workflow-core`.

## Public shape and ownership

`Workflow<StepName, Input, State, Resources, Result>` binds `resources: Resources` at construction,
alongside its Step configuration. `resources: undefined` is explicit for resource-free definitions.
`RunnableWorkflow<Input, Result>` implements
`run({ input, signal?, parentRunId?, onEvent?, classifyFailure? }): Promise<Result>`.
`WorkflowRunOptions<Input>` has no Resources parameter; extra execution properties cannot replace
the binding. Every run uses the same resource instance captured at assembly. Replacing the original
definition's Resources field does not change that binding.

`createState({ input, resources })` converts external input into run-local business data. The
consumer defines its shape, including callable, primitive or `void` state. Steps, executors and lifecycle
hooks receive `WorkflowContext<StepName, State, Resources>` with state, resources and execution
controls. Context views expose neither raw input nor a result slot. `createResult(state)`
synchronously projects a `TResult` from state. `createSkippedResult({ input, reason })` produces the
same return type when a condition skips. Treat state as read-only during projection. These functions
transform data without acquiring resources. Both factories must return a synchronous value. A
Promise or callable thenable fails with `WORKFLOW_RESULT_ASYNC`. Core observes native Promise
rejections immediately and rejects custom thenables without calling their `then` method.
Assembly rejects missing or malformed result factories with `WORKFLOW_RESULT_FACTORY_INVALID`
if `createResult` is absent or either supplied factory is non-callable.
`resources` and `state` references and execution fields cannot be reassigned.
The framework does not clone or deep-freeze referenced objects. Bound capabilities retain their class
identity and mutable contents; consumers own adapter and closure concurrency safety. Each run creates
its own state, admission/cancellation scopes, Step counts and observation. Binding does not
acquire resources or grant ownership; per-operation leases/transactions keep their own release owner.

Each Step receives a scope-bound context view. Views share state and resources,
but have their own effective signal and runner admission lifetime. Thus a parallel group can cancel
its children without modifying the parent's context or signal. Retained child contexts cannot start
late work after their invocation closes. No context view conveys ownership of borrowed resources.

A consumer can use a union if skipping has a distinct outcome. Core adds no outcome envelope or
default value. A supplied factory can return `undefined` when its return contract permits it.
State need not match the result shape. If the projection returns a reference from state, it remains
a shared reference. Project a separate object if cleanup might mutate referenced state.

## Run ordering

1. Generate a run identity, emit start, reject already-cancelled admission.
2. Evaluate the condition with input/resources/effective signal.
3. Check cancellation at this pre-execution boundary. If skipped, call `createSkippedResult`, emit
   skipped and return its value. Without a skip factory, fail with `WORKFLOW_SKIP_RESULT_MISSING`.
   A throwing skip factory fails the run. This path runs no Steps, state factory, normal result
   projection or lifecycle hooks.
4. Create state and assemble context. A factory failure emits failed; hooks requiring context do not
   run. The external resource owner's `try/finally` must cover the entire `run()` call.
5. Admit the entry Step through the normal registry and executor. Track actual calls before running
   user code. Each invocation closes admission and joins its descendants before settling.
6. Close run admission and drain all registered work. On success, call `onSuccess`, then
   `createResult(state)`. On execution, success-hook or projection failure, call `onError`.
7. Run `onFinally` for every assembled context. Hooks cannot start new Steps. Retain errors in causal
   order, including cleanup errors. Emit completed and return the projected value only after successful
   cleanup. A cleanup-only failure emits failed and throws without a second call to `onError`.

Framework checks cancellation before starting work. It does not rewrite an awaited successful Step
or committed result because cancellation arrived during/after that work. Adapters must honor signals
before their commit point and truthfully report committed results. An explicitly enabled local timeout
has its own terminal semantics. There is no default deadline.

## Registration, errors and drain

Definition resolves a frozen registry snapshot. Required/optional policies, named override resolution,
policy-only override inheritance and serial cardinality are preserved. At-most-once counts failed and
skipped invocations too. Repeatable permits serial calls, never overlapping calls of the same name.
Unknown names, cardinality violations and business failures may be caught deliberately by the caller.
An observed and handled business failure does not poison the Workflow.

An entry or composite that returns successfully with registered children still pending violates the
execution protocol. Lock that failure at run level, close admission, request cancellation, then drain.
Catching it cannot convert the run into success. An entry/composite that fails cancels and joins its
pending children before settling, retaining independent child failures. Promises are observed internally
to avoid process-level unhandled rejections; this is not proof that user code awaited a settled promise.

Custom executors can retry an implementation serially inside one logical invocation. They must invoke
the supplied implementation with the supplied context, at least once, and await every attempt. Missing,
concurrent, late, mismatched-context or unfinished attempts are protocol failures. Executor-recovered
business failure is allowed; framework does not implement retries itself.

Each implementation attempt receives a fresh scope-bound view of the same run data. The executor
passes its supplied context to the guarded callable; core supplies the implementation's effective
view. Attempt-level children are closed/joined before control returns to the executor, so executor
post-processing cannot hide a prematurely returned body. Successful retries do not reset named child
cardinality. An old attempt's context cannot admit work during a later attempt.

## Managed parallel groups

`await context.parallel(['readA', 'readB'])` admits registered named Steps concurrently through the same
registry/executor/cardinality tracker. Names are snapshotted. A child group owns an AbortController and
inherits the parent's signal; nested calls inherit the effective group signal. First observed failure
requests sibling cancellation; the group waits for all children to settle before rejecting. Duplicate
names follow normal overlapping-call rules. Empty groups succeed unless already cancelled/closed.

Primary failure remains first; other distinct failures are preserved using AggregateError with the
primary as cause. Induced cancellation must not hide the initiating error. A parent can catch an
ordinary group failure and continue with its still-live signal. Protocol failures remain fatal.

The helper protects resource lifetimes only when awaited by the resource owner. It cannot repair a
manually closed connection or control unregistered JavaScript work. Non-cooperative promises may keep
drain pending indefinitely; no race/timeout claims the underlying work has stopped.

## Observation and limits

Observer receives frozen metadata events, never context, results, resources or raw exceptions. Calls
are made in emission order. Synchronous throws and asynchronous rejection are isolated; promises are
not awaited, so slow observers cannot prevent cancellation or cleanup. Observer delivery/flush is
owned by the host, not a resource tracked by the Workflow. Identifiers and skip reasons are authored
by the consumer and must not contain secrets. Correlate Agent/Operation identity in a host adapter.

`run()` optionally accepts `classifyFailure(error): string | undefined`. This synchronous, run-local
callback receives the actual failure at an observed Step or Workflow failure boundary. Its accepted
return is the failure event's optional `errorCode`: 1–128 ASCII characters matching
`[A-Z][A-Z0-9_]{0,127}`. No automatic extraction from exceptions, coercion or truncation is performed.
Only `step-failed` and `workflow-failed` carry this field. A recovered child failure remains observable
even when its parent succeeds; the terminal Workflow error may differ after hooks or cleanup.

Without an observer the classifier is not called. Without a classifier, or when it returns undefined,
throws or returns an invalid value, the failure event is still delivered without `errorCode`.
Promise/thenable returns are invalid: they are never awaited or used as codes; rejections are observed
to avoid an unhandled rejection. Classification return values and failures do not replace the thrown
error or change execution, cancellation, drain or cleanup outcomes. Classifiers are trusted host
callbacks, not sandboxed code: keep them
short and observational, do not mutate errors or acquire resources, and map to a known public code
vocabulary. Syntax validation alone cannot determine whether a string contains a secret.

No automatic resource close, transaction, rollback, persistence, durable idempotency, retry scheduler,
queue, concurrency limiter, or mandatory business rule enforcement is promised. An overridable entry
can bypass any Step; critical invariants belong to the real domain/commit boundary.
