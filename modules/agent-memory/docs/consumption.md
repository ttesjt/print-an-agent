# Composing and operating Context Memory

## Concepts and owners

A **Document** is the logical object identified by caller-selected `memoryId`. A **Snapshot** is its
current revision, configuration, ordered items and derived measurement. An **Item** is an editable
`id/content/metadata?` entry. These are not chat Sessions. Map project/user/session scopes to memory
IDs in the host; there is no hard-coded one-Agent/one-memory relationship.

A **Bundle** assembles native Workflows using shared borrowed resources. Each call gets independent
state and a signal. The deterministic profile exposes create/apply/configure/readContext/getReceipt;
the model profile adds observe/edit/compact. No extra service, runner, Agent runtime or provider is
created. The host owns its database, model/counter capabilities, scheduling and aggregate prompt budget.

```text
Host: owns and lends store / meter / planner / policies
  → Native Workflow: chooses and orders Steps; owns per-run state
    → Private candidate capability: original source, evolving items, final publication checks
      → Store: atomic request arbitration, CAS, snapshot + receipt
```

Choose a real consumer-compatible `TokenCounter<TextTokenInput>` from Model Invocation Core; one can
be supplied by an Actor or explicitly configured using `@ta-agent/model-invocation-token-counters`.
Bind its descriptor's `measurementRef`. An encoding is an explicit host choice, not a guess from a
model name. Hard limits require exact text measurement. Estimates are allowed only where the
applicable budget policy permits them; text fragment counts are not whole-request token counts.

See the [API guide](../packages/context-memory/README.md) and the
[executable, typechecked host example](../tests/qualification/examples/project-memory.ts).
The example is a function tested against real SQLite, not an additional production framework. Its
fixed example request IDs deliberately make reruns replay the same experience; real hosts assign a
new stable business request ID to each new operation. Changing input under an old ID is an error.

## Host lifecycle

Create resources once and reuse them. Creating a resource object or Bundle does not open connections;
constructing `SqliteMemoryStore({ path })` does. `{ database }` borrows a connection instead. The host
must create the parent directory and close each resource it owns only after all its users settle.

```ts
// bundle and store are already assembled; this host admits one illustrative operation.
const controller = new AbortController();
const work = bundle.workflows.edit.run({ input, signal: controller.signal });
// During shutdown: stop admitting new work, then cancel every operation this host owns.
controller.abort();
const [outcome] = await Promise.allSettled([work]);
store.close(); // no operation can still borrow this connection
// Inspect outcome; cancellation/close failure must not be reported as successful work.
```

With multiple users, join **all** of them, not just the currently visible operation. Memory does not
automatically abort siblings or shut down models. Cooperative cancellation waits for borrowed work
to settle; it cannot kill an uncooperative adapter. Default deadlines are disabled. Enabled Memory
deadlines cover default business Steps and retry cycles, not arbitrary Core lifecycle hooks; hosts
own outer lifecycle time limits. Repeated immediate results still yield between retry attempts.

Rollback failure poisons the SQLite adapter and remains observable through subsequent calls/close.
Do not silently clear that error or reuse the poisoned adapter. A borrowing host still owns native
connection cleanup. Preserve both operation and cleanup errors, for example with `AggregateError`;
do not let a `finally` exception hide the original failure. The host example retains both failures.
The SQLite lock-wait timeout is not an LLM timeout, and synchronous native work is not preemptible by JS.

## Durable results and recovery

Mutation results distinguish `committed`, `unchanged` and condition-`skipped`. Both committed and
unchanged operations have a persisted terminal receipt; skipped does not. Unchanged does not advance
revision. Queries skipped by a condition return undefined; a missing document is an error.

`requestId` is business identity, not Workflow run identity. CAS attempts keep it fixed; a new editing
request gets a new ID. Receipts match memory ID, operation and canonical input digest. Request
arbitration happens before revision checks, so concurrent identical requests return the winner's IDs
and original result. Model computation can happen more than once; publication cannot.

| Failure commit fact   | Host action                                                                             |
| --------------------- | --------------------------------------------------------------------------------------- |
| `not-committed`       | Fix the cause; only definite CAS conflicts are automatic model replans                  |
| `committed` + receipt | Keep the exact result; recover presentation without executing the model again           |
| `unknown`             | Restore connectivity and query the same memory/request before deciding whether to retry |

```ts
const receipt = await bundle.workflows.getReceipt.run({ input: { memoryId, requestId } });
if (receipt !== undefined) {
  // This is the original terminal result; it may be older than the current document revision.
  const committed = { status: receipt.status, receipt };
  // Deliver committed without manufacturing a new editing request.
}
```

An absent receipt while an original invocation is still active is not proof that it cannot commit.
After it settles, a retry uses the **same** operation, ID and input, allowing durable arbitration.
Do not change input, issue a new ID or automatically replan unknown outcomes. Replaying a known
request does not call the planner. Future state changes do not alter the original receipt.

An Executor's post-processing or success/finally hook may fail after publication. Default definitions
retain the receipt and original cause even if the later failure claims `not-committed`. Independent
failures can be an `AggregateError`; inspect its children for commit facts rather than reporting an
aggregate as a rollback. A committed error is still an error in delivery/cleanup, not a false success.

## Customization without a fork

Use public package exports; never import source/dist internals or another app's wiring. Extension
functions are trusted host code, not a security sandbox. Ordinary Steps receive guarded domain
capabilities instead of an unvalidated store writer. Hosts implementing a new store must uphold its
atomic request/CAS contract; arbitrary code that deliberately writes SQL is outside that guarantee.

| Change                 | Public seam                                                           |
| ---------------------- | --------------------------------------------------------------------- |
| Formatting / tokenizer | `MemoryRenderer`, `MemoryMeter`, shared `TokenCounter` / resolver     |
| Persistence            | `MemoryStore`; validate it with real concurrency and receipt recovery |
| Content rules / IDs    | optional `validateItem` / `createItemId` during host assembly         |
| Task instructions      | `createCompletionMemoryPlanner({ completion, instructions })`         |
| Model planning         | `MemoryPlanner` via `createModelMemoryResources`                      |
| Soft-target feedback   | resource `refine` or named `refineCompactionPlan` Step                |
| Step behavior          | `createMemory*Definition({ stepOverrides, executeStep, lifecycle })`  |
| Complete graph         | replace a Bundle member with a resource-free native definition        |

`createMemory*Definition()` exposes public `stepDefinitions`: compose a default Step by retaining its
function and invoking it inside an override. This changes implementation, not Core's execution
protocol; await all started work and respect Step cardinality. Custom model Steps use
`modelMemorySignal(context)` to preserve both child-scope cancellation and the domain deadline.

```ts
const shared = { stepOverrides: { planCompaction: customPlanStep } };
const workflows = {
  observe: createMemoryObserveDefinition(shared),
  edit: createMemoryEditDefinition(shared),
  compact: createMemoryCompactDefinition(shared),
};
const bundle = createContextMemoryBundle({ resources, workflows });
```

One resources object shares the planner, compaction instructions and controller across all entries.
Sharing named overrides is explicit, as above. Replacing only the public `compact` definition does
**not** silently replace the internal candidate cycle in observe/edit. They never call a public
committing Workflow recursively. Full graph replacements own their scheduling, retry/deadline and
custom cleanup policies; keep default definitions when only a Step or instruction needs changing.

Private publication revalidates actual items, optional content policy, canonical full-render budget
and any private compaction target, even if a custom graph skips assessment. The planner cannot set
revision/configuration/measurement or supply addition IDs. Replacing metadata by default apply is
different from model replacement, which preserves existing metadata. Source/configuration stay
fixed per candidate cycle; a definite CAS conflict starts a new cycle from current authority.

## Limits and verification

Memory does not promise semantic losslessness, automatic edit-history reconciliation, whole-request
capacity, cross-memory transactions, exactly-once model calls, full version history, deletion/archive,
background task durability or automatic model loading. Receipt retention is currently unbounded.
Custom policy and model-quality evaluation belong to the host; deterministic tests do not prove that
a real LLM will preserve every important fact. Application integration and Retrieval Memory are separate.

Run `pnpm test:memory-qualification`. It builds/typechecks the independent consumer, validates public
boundaries and runs domain, SQLite and qualification suites without network or credentials. The
consumer tests include a full alternative compact graph and real SQLite delivery/rollback failures;
they are separate from implementation unit tests and share no internal fixtures.
