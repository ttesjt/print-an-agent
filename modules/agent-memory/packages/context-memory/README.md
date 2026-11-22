# @print-an-agent/context-memory

Context Memory maintains independent documents keyed by caller-selected `memoryId`. Snapshots contain
ordered `{ id, content, metadata? }` items, configuration, revision and derived token measurement.
Item IDs are system-generated. Ordinary commands add, replace or remove items atomically.

Optional immutable history, historical rendering and independent forks are documented in
[VERSIONING.md](./VERSIONING.md).

## Source organization

The npm API remains the deliberate named exports in `src/index.ts`, with one package export.
Internal features expose named entries; ordinary responsibility folders stay within their owner.
Independent types live in the owner's `types.ts` or `types/`. Only common JSON, document and receipt
facts live in package-level type modules. The controlled mutation operation names and their derived
union stay together in `mutation-operations.ts`.

```text
src/
  index.ts                         # Stable public values and types
  errors.ts                        # Domain errors and cancellation
  mutation-operations.ts           # Shared operation discriminators and derived union
  types/                           # Common JSON/document/receipt/error facts
  values/                          # Strict values, canonical JSON, digests, nullable limits
  document/                        # Items, commands, normalized configuration, snapshot validation
  measurement/                     # Borrowed counter/renderer binding and completed-result cache
  budget/                          # Document limits, fixed targets, measured assessment
  persistence/                     # Store protocol, request/receipt arbitration, commit facts
  mutations/                       # Deterministic writes and common guarded candidate publication
  context/                         # Current reads and reusable measured snapshot rendering
  history/                         # Exact versions, pagination, forks and historical rendering
  model-update/                    # Private run-local candidates and model edit projection
    types/
    policy/                        # Finite defaults and execution policy validation
    planner/                       # Borrowed Completion, instructions, output and failure mapping
  workflows/
    create-bundle.ts               # Public deterministic/model Bundle selection
    shared/                        # Resource-neutral Definition/input/output/lifecycle mechanics
    state/                         # Narrow authority queries and replay resources
    deterministic/                 # Current document operations and one default definition recipe
    model-driven/
      create-definition.ts         # Observe/edit/compact Definition creation
      step-definitions.ts          # Authoritative graph, cardinality and skip rules
      steps/                       # Preparation, planning and candidate Steps
      execution/                   # Candidate/compaction cycles, retry yields, deadline and signal
      types/
    history/                       # Narrow history Resources, Definitions and Bundle
    versioned/                     # Explicit current/history composition and historical read
```

Domain features do not depend on Workflow profiles. Document budgets have one limit evaluator;
assessment reports violations while publication preserves its established error priority and always
revalidates/re-measures the actual candidate. Input-model budgets, soft planner goals and final
rendered acceptance retain distinct meanings.

Current reads never select history implicitly. History selects an exact persisted version before
using Context's measured rendering capability. State-only and History-only resource installations
need no model, counter or renderer. Versioned composition explicitly adds historical rendering to
the deterministic current-document operations.

Workflow factories return native Core definitions. Shared mechanics do not depend on concrete
profiles; profiles borrow narrow domain operations and do not own stores/models. Model Steps and
execution coordination have separate modules, with one graph/default assembly. The single business
deadline still encloses candidate and conflict-replan work; Core lifecycle hook ownership is unchanged.

Package tests follow domain responsibilities under `test/unit`, `test/integration`, `test/types`
and shared `test/support`. The source-boundary test checks declared nested entries, one-way imports,
type-module erasure and literal source cycles including type references. See the
[development coverage](../../../../docs/development.md#declared-source-feature-boundaries) for
static-analysis limits. SQLite transactions/history codecs remain in the separate adapter package.

## Contracts

- `resolveMemoryConfig` binds an actual `measurementRef`; no universal token estimator is assumed.
- Text rendering defaults to a newline separator; JSON rendering includes IDs and content.
  Rendering is document configuration, not an implicit per-read override.
- `resolveExecutionPolicy` centralizes finite defaults (three compaction passes, two CAS retries)
  and configurable feedback policy. Explicit `null` disables the corresponding attempt bound.
- `resolveCompactionTarget` supports either direct tokens or base limit × ratio − reserve.
  Overrides never relax the persistent document limit.
- `parseModelOperations` accepts a JSON **operations array**, not an updated document. Model edits
  cannot supply item IDs for additions, metadata, revisions or token counts. Planner replacements
  preserve existing metadata through `projectModelOperations`; public apply replacements replace
  the whole item and omit old metadata when no replacement metadata is provided.
- A host-owned `MemoryStore` atomically arbitrates request identity and revision, updates a complete
  snapshot and records a terminal receipt. Replaying a known request returns its original result.
  No model or token counter runs in the write transaction.

Memory documents are not conversation Sessions. Shared resources are borrowed; closing a database,
Actor or other capability belongs to the host after its in-flight operations have settled.

## Deterministic domain use

`MemoryMutations({ store, meter, defaults?, createItemId?, validateItem? })` is the validated domain
write boundary, not a Workflow executor. Its `create`, `apply` and `configure` methods validate the
whole candidate and enforce the actual rendered budget before calling the store's atomic commit.
They preserve committed/unknown errors and do not report cancellation after a successful commit.
An already-read, validated matching receipt also wins over late cancellation. Before rejecting a
stale apply/configure revision, the boundary rechecks its receipt to recover concurrent replays;
this does not retry the edit or relax CAS for genuinely stale writes.
Empty additions are ignored; blank replacements remove their target; invalid commands publish nothing.

`MemoryMeter` borrows a `TokenCounter<TextTokenInput>` from `@print-an-agent/model-invocation-core` and a
renderer. Use `new MemoryMeter({ counter })`, for example with an Actor's `textTokenCounter`, or inject
`resolveCounter(measurementRef, signal)` for explicit host-owned selection. The requested identity must
match the resolved descriptor; no alias, model-name inference or fallback is performed.
It caches only completed measurements in a bounded cache
(`maxCacheEntries`, default 128, zero disables caching), keyed by the full counter descriptor and text.
Every full measurement includes renderer/configuration and item digests. Item counts are planning
hints, never a substitute for the full rendered count. Custom renderers use explicit identities.
Snapshot measurements use the shared `tokens`, `accuracy`, `measurementRef`, `inputProtocolRef` and
`scope` fields, including per-item results. Persistence preserves and validates this evidence.
Finite context/item token budgets require `exact` accuracy; estimates fail with
`TOKEN_MEASUREMENT_INEXACT` before commit. Unbounded documents may store estimates.

`readMemoryContext({ store, meter }, input)` returns an entire snapshot and its actual rendered text.
Reads can select a `measurementRef` but not a temporary renderer/separator. Default `enforce` rejects an
oversized result; explicit `report` returns it with budget status. No read truncates, invokes a model,
changes configuration or advances revision. Disabled budgets return `unbounded`, not a fake pass.
`report` may return estimated results; its budget comparison is descriptive, not proof of exact fit.
Even a cached estimated count cannot satisfy a later finite `enforce` read.

The host should give Workflow consumers this domain boundary rather than a raw store writer. The
store port and persistence decision helpers are for adapter composition and contract testing; they
do not replace token counting or provide a second unvalidated Workflow write path.

## Workflow and Bundle use

```ts
const resources = createContextMemoryResources({ store, meter, defaults: { measurementRef } });
const bundle = createContextMemoryBundle({ resources });
await bundle.workflows.create.run({ input: { memoryId: 'project:a', requestId: 'create:1' } });
const context = await bundle.workflows.readContext.run({ input: { memoryId: 'project:a' } });
```

The six deterministic members require no Actor. Each `createMemory*Definition(options?)` is a
resource-free Core definition, also usable as `new Workflow({ ...definition, resources })`. Options
accept normal Step overrides, condition, executor and lifecycle hooks. Bundle `workflows` can replace
complete definitions. Resources contain narrow domain operations, not a raw store writer. Assembly
does no I/O; the host still owns resource cleanup after all runs settle.

Default definitions register `prepareInput`, `executeOperation` and `runMemoryOperation`. The
original input is available read-only as `context.state.input`. The default `prepareInput` Step
calls `context.state.prepareInput()` to validate it as JSON and detach it into the read-only
`context.state.preparedInput` slot. An override that keeps downstream Steps can wrap the default
Step or explicitly prepare the input. Deterministic overrides may pass a same-type replacement to
`state.prepareInput(replacement)`; it is also validated and detached before the domain call.
Returning without preparation does not admit a domain call. Default execution records
`context.state.operationOutput = { value }` for the result projection. The wrapper distinguishes a
completed lookup whose value is `undefined` from a Step that produced no output. A condition-skipped mutation returns
`{ status: 'skipped', reason: 'condition-not-met' }` without a receipt. Skipped queries return undefined;
missing receipt queries also return undefined, whereas a missing document read is an error.
Default Executor/lifecycle wrappers retain an acknowledged mutation receipt if Step post-processing
or a success/finally hook fails, even if that failure claims the mutation was not committed;
Core preserves independent failures in an AggregateError when multiple phases fail.

## Model-driven workflows

```ts
const planner = createCompletionMemoryPlanner({ completion }); // borrowed CompletionCapability
const resources = createModelMemoryResources({
  store,
  meter, // counts the memory consumer's context, not the compaction model's output
  defaults: { measurementRef, maxContextTokens: 4096 },
  planner,
});
const bundle = createContextMemoryBundle({ resources });
await bundle.workflows.observe.run({
  input: {
    memoryId: 'project:a',
    requestId: 'observe:1',
    context: [{ role: 'user', content: 'Prefer concise answers.', source: { turnId: 't1' } }],
  },
});
await bundle.workflows.edit.run({
  input: {
    memoryId: 'project:a',
    requestId: 'edit:1',
    instruction: 'Remove outdated preferences.',
  },
});
await bundle.workflows.compact.run({
  input: { memoryId: 'project:a', requestId: 'compact:1', target: { maxTokens: 3000 } },
});
```

The model-enabled Bundle contains the same six deterministic members plus `observe`, `edit` and
`compact`. Each has a standalone `createMemory*Definition`. No Agent runtime, Session or credentials
resolver is created by Memory. The host decides when/what experience to submit, including roles and
provenance; Memory does not assume a chat post-processing schedule or infer edit history.

Every run retains an immutable source and a private in-memory candidate. The planner sees original
and current `id/content` items, caller-supplied experience and editing instructions. It never receives
stored item metadata, render settings or internal token counts. It returns edit operations, not a
replacement snapshot. Candidate compaction can merge, add, remove or rewrite globally; additions
receive system IDs and replacements preserve metadata. Default compaction cannot clear a nonempty
candidate merely to pass the budget. Explicit edit/apply removal of all items is still valid.

Acceptance always re-renders and measures the **whole** candidate, including separator/JSON overhead.
Intermediate candidates never persist. The domain publication capability independently revalidates
actual items, item policy, canonical budgets and the private compaction target; replacing a planning
or assessment Step cannot bypass these checks. One successful run commits at most one snapshot and
terminal receipt. A replay returns that receipt without invoking the planner. Concurrent identical
requests may plan more than once; durable arbitration prevents duplicate publication, not duplicate
provider computation.

### Targets and feedback

`compact.target` accepts `{ maxTokens }` or `{ limitTokens?, ratio?, reserveTokens? }`:
`T = floor(limitTokens * ratio) - reserveTokens`. The default uses the document's `compactionTarget`
(80% of its context limit). An explicit `measurementRef` and/or `render` in the target can prepare for
a future configuration; it does not change the stored configuration. The current document's budgets
and this alternate target must both pass. Token counts from different measurement views are not
compared as if they were the same units. With a disabled context limit, explicit compaction needs a
concrete target/base; automatic capacity compaction does not invent one.

The final full-render target `T` is fixed. The model receives only the soft content goal `P`. After a
rejected candidate, the default controller uses the tightest violated budget ratio:
`P_next = max(minPlannerTargetTokens, floor(min(P, C) * ratio * retrySafetyFactor))`, where `C` is the
sum of item counts for planning only. It never subtracts an assumed additive separator cost or
relaxes `T`. New legal candidates are reprocessed, including their current IDs/content. Even a
candidate below the hard document ceiling cannot commit while it exceeds the smaller target.
Exhaustion retains the old snapshot and reports passes, actual/target counts and violated limits.

### Policies, cancellation and customization

`createModelMemoryResources({ policy })` centralizes defaults:

| Policy                   | Default | Meaning                                                       |
| ------------------------ | ------- | ------------------------------------------------------------- |
| `maxConflictRetries`     | 2       | Extra read/replan cycles after definite CAS conflicts         |
| `maxCompactionPasses`    | 3       | Maximum compaction model calls per candidate cycle            |
| `retrySafetyFactor`      | 0.9     | Feedback tightening factor                                    |
| `minPlannerTargetTokens` | 1       | Soft goal floor, never permission to relax the final target   |
| `maxInputTokens`         | null    | Optional experience/instruction JSON budget                   |
| `timeoutMs`              | null    | One cooperative domain deadline for all candidate/replan work |

Attempt bounds accept `0` to disable and explicit `null` to unbound that loop. CAS and compaction
counts are independent; inner counts restart on a fresh source, not the outer deadline. Only definite
not-committed revision conflicts replan using the latest snapshot/configuration and original input.
Between repeated compaction attempts and CAS cycles, the default loop yields to the event loop and
rechecks cancellation. Immediate planners/counters therefore cannot starve deadline or abort timers.
Provider failures, malformed/truncated output and unknown commits are not business retries. Query
`getReceipt` before deciding how to recover an unknown result. `apply` and `configure` never invoke a
model or perform implicit compaction.

Input limiting requires an explicit borrowed `inputCounter`; it measures experience/instruction
JSON, not the complete provider request. Output acceptance uses the document/target counters. A
deadline cancels and waits for borrowed work to settle; it cannot force-stop an uncooperative adapter.
It covers the default business Steps, not arbitrary Core lifecycle hooks. Hosts own outer deadlines
and resource draining. Narrower Actor timeouts retain their cause; a known commit is never relabeled
not-committed by late cancellation, a deadline or lifecycle cleanup failure.

Customize `createCompletionMemoryPlanner({ completion, instructions, maxOutputCharacters })`, supply
another `MemoryPlanner`, replace resource `refine`, override named Steps, or replace entire Bundle
definitions. Default output safety bound is 65,536 characters, configurable. No provider HTTP loop or
automatic model retry is added. Named model Steps are `prepareInput`, `beginUpdate`, `checkInputBudget`,
`planUpdate`, `applyUpdate`, `measureCandidate`, `assessCandidate`, `planCompaction`, `applyCompaction`,
`refineCompactionPlan` and `commitCandidate`, coordinated by `runModelOperation`. Custom Steps should
pass `modelMemorySignal(context)` to borrowed work so both Core child-scope cancellation and the
Memory-owned deadline are respected. Resources are shared; mutable state remains per run.
`ModelMemoryState<Input>` and `ModelMemoryContext<Input>` preserve each operation's input type.
Custom Edit Steps can read `context.state.input.instruction`, Observe Steps can read
`context.state.input.context`, and Compact Steps can read `context.state.input.target`.
`beginUpdate` only uses the detached input. Model-driven `state.prepareInput()` takes no replacement;
shared Steps cannot substitute another operation's input. Both input slots are read-only.
