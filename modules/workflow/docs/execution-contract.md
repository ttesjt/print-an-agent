# Workflow Core execution contract

Execution semantics, customization boundaries and resource ownership for `@ta-agent/workflow-core`.

## Public shape and ownership

`Workflow<StepName, Input, State, Resources, Result>` implements
`run({ input, resources, signal?, parentRunId?, onEvent? }): Promise<Result>`.
`createResult({input, resources})` and `createState({input, resources})` are pure synchronous
factories. They provide business data, never a complete framework context or hidden acquired resources.
`context.result` is a typed shared result slot; object mutation and whole-value replacement are both
allowed. `input`, `resources` and `state` references and execution fields cannot be reassigned.
The framework does not clone referenced objects. Consumers own adapter and closure concurrency safety.

Each Step receives a scope-bound context view. Views share input, state, resources and the result slot,
but have their own effective signal and runner admission lifetime. Thus a parallel group can cancel
its children without modifying the parent's context or signal. Retained child contexts cannot start
late work after their invocation closes. No context view conveys ownership of borrowed resources.

Result defaults must be truthful: `[]` for a change list, `0` for a count, `undefined` for `void`, or a
consumer union such as `{status:'not-produced'} | {status:'produced', value: Document}`. A consumer
that cannot supply a valid default must change its own result type, not cast a fake value. Core never
adds an outcome envelope. Agent-specific patches and their safe application belong to the host.

## Run ordering

1. Generate a run identity, emit start, reject already-cancelled admission.
2. Create the initial result; evaluate condition with input/resources/effective signal.
3. Check cancellation at this pre-execution boundary. If skipped, emit skipped and return the initial
   result. No state factory or lifecycle hook runs on this path.
4. Create state and assemble context. A factory failure emits failed; hooks requiring context do not
   run. The external resource owner's `try/finally` must cover the entire `run()` call.
5. Admit the entry Step through the normal registry and executor. Track actual calls before running
   user code. Each invocation closes admission and joins its descendants before settling.
6. Close run admission, drain all registered work, then call onSuccess; on execution/onSuccess failure
   call onError. Always call onFinally for an assembled context. Hooks cannot start new Steps.
7. Preserve execution, onError and onFinally errors in causal order. Emit completed/failed and return
   the current result slot or throw. A cleanup-only failure throws (no second call to onError).

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
