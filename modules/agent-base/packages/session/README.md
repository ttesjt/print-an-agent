# `@print-an-agent/base-session`

Generic Session, append-only lineage, navigation, context-projection, and compaction ports for Agent
Base.

The package defines Session ports and domain behavior without selecting a concrete persistence
implementation. Official process-local Memory and durable SQLite implementations live in
`@print-an-agent/base-local-adapters`.

`sessionId` is the sole immutable, opaque Session identity. Adapters allocate fresh IDs and must
never reassign them, including after deletion or reconstruction. Official adapters default to UUIDs;
custom generators may use other reliable IDs within the validated bounded string format. `title`
is the existing optional, mutable, non-unique human-readable label; it does not select identity.

`resolve({ agentId })` creates a new Session. Supplying `sessionId` only opens an existing
Session owned by that Agent; an unknown ID returns `SESSION_NOT_FOUND`, never an implicit creation.
Generated collisions within an adapter's store return `SESSION_ID_CONFLICT`, without modifying or
returning the existing Session. A custom generator is responsible for avoiding reuse across deleted
records or independent stores; the framework does not maintain a global ID registry or tombstones.

Session Lifecycle has separate query, retire/restore, optional purge, execution-fence and recovery
contracts with pure validation/authority helpers. See [lifecycle contract](docs/lifecycle.md) for
state, CAS, busy, stale-reference and cleanup semantics. Official local adapters implement these
capabilities, and runtime Workflows propagate execution leases. No Agent/Workflow management API
is added; lifecycle management remains a separate capability.

```ts
import { createDeterministicAgentAPI } from '@print-an-agent/base-composition';
import { SqliteSessionAdapter } from '@print-an-agent/base-local-adapters';

const session = new SqliteSessionAdapter({
  databasePath: '/explicit/application/data/agent-session.sqlite',
  tablePrefix: 'product_',
  tableNames: { sessions: 'conversations' },
});
const agent = createDeterministicAgentAPI({
  identity: { id: 'assistant' },
  session,
  provider: { responses: [{ status: 'success', text: 'Ready.' }] },
});
```

Both official local adapters implement `NavigableCompactableSessionPort`, `SessionQueryPort`, and
`SessionMetadataPort`.
Both also implement the optional `SessionPresentationPort`. It supplies an exact bounded
`readTurnPresentation({ agentId, sessionId, turnId })` lookup and an atomic
`completeTurnWithPresentation()` operation on the same adapter. A `SessionTurnPresentation` contains
an ordered `reasoningBlocks` array of named `SessionReasoningBlock` values, each containing
`modelTurnIndex` and readable `text`. Indices are positive, strictly increasing model invocation
ordinals within the Session turn; omitted/filtered reasoning can leave gaps. No provider signatures,
model-input meaning, or arbitrary JSON extension bag is accepted. The record includes its original branch identity and survives branch selection,
rewind, and compaction without being copied or reparented.

Presentation is absent from ordinary snapshots, turn-ledger queries, history, and context projection.
Consumers explicitly query the display record; a missing turn or absent presentation returns
`undefined`. Empty records are invalid. `MAX_SESSION_PRESENTATION_CHARACTERS` bounds one record to
64,000 UTF-16 code units across all blocks; `MAX_SESSION_PRESENTATION_BLOCKS` limits structural
overhead to 1,024 nonempty blocks. Validation returns deeply detached frozen values and rejects extra fields and
accessors. Malformed inputs use `SESSION_PRESENTATION_INVALID`; overflow uses
`SESSION_PRESENTATION_LIMIT_EXCEEDED`; corrupt stored records use `SESSION_RECORD_INVALID`.
Domain ports select no default retention policy. The official composition selects capture Steps,
while a custom Session adapter may omit this entire capability when capture is disabled.

The query port lists recently active Sessions with keyset pagination, inspects bounded summary
metadata, and pages the newest-first durable Turn ledger across all branches and terminal states.
The metadata port renames a Session through an independent revisioned CAS; its stable Session ID and
conversation-activity ordering do not change.
It deliberately omits unbounded Turn and Branch collections from Session inspection. Branch listing
requires a separately bounded query contract when a real consumer needs it. The query ledger is
separate from `loadHistory()`: the latter selects completed model context, whereas the ledger is a
lossless product read primitive.

Every Session starts on the stable `main` branch. Turns record immutable branch and parent-turn
authority, and successful completion alone advances a branch head. `resolve()` captures the selected branch plus a navigation revision;
`beginTurn()` verifies that authority atomically, so a stale request cannot silently attach to a new
selection. One active turn is allowed per branch.

`executeSessionNavigation()` is the complete Session-owned navigation coordinator. It validates the
closed command, inspects Session authority, acquires an execution lease when the adapter supports
one, applies the adapter-owned CAS mutation, and releases admitted execution in `finally`-equivalent
cleanup. It supports read-only inspection, selecting an existing branch, creating an unselected fork
at a completed ancestor, and non-destructive rewind. Rewind creates and selects a child branch; it
never moves a source head, reparents a turn, or deletes history. Cancellation can prevent a mutation
before `applyNavigation()` begins; once adapter mutation starts, the coordinator waits for its real
outcome and never reports a misleading cancelled result after a successful commit.

The optional Session navigation Workflow is a native `@print-an-agent/workflow-core` Workflow. Construct it
with `createSessionNavigationWorkflow({ resources: { session }, ... })`, then call
`run({ input: { agentId, navigation, traceEmitter? }, signal })`. It returns its navigation outcome
directly and needs no Agent Run Context. The Session port is bound once; the optional trace emitter,
navigation state and execution lease belong to each individual invocation. Reusing a Workflow does
not retain a preceding call's trace identity. Its default validation, inspection, and
commit Steps delegate to the same package-internal domain phases as the coordinator, so the Workflow
does not own a second navigation algorithm. Standard composition does not install it: ordinary
navigation uses the out-of-band management Service and requires no Actor, provider, credential, Tool
runtime, Agent trace, or materialized Agent.

Navigation overrides record an already handled outcome in `context.state.outcome`. Default inspection
and commit respect that outcome and avoid starting another navigation write. The Workflow projects
the outcome from state and releases any admitted execution lease through its normal final cleanup.

Raw completed turns remain authoritative through `loadHistory()`. Compactions are isolated per
branch and store a revisioned projection through an exact completed ancestor. `loadContext()` then
returns that branch's context message followed by its completed raw tail. CAS prevents stale
compactions from replacing a newer revision, and no compaction deletes or rewrites a turn. A child
inherits a source projection only when its boundary remains an ancestor of the branch point.

`compactSession` is a public Agent Operation backed by a native, replaceable Core Workflow.
The official composition supplies registered Steps for Session inspection/source selection, target
and Actor resolution, candidate construction, generation, token measurement, validation, feedback
and publication. Raw leaf definitions fail fast. Each generation uses the `session-compaction`
Responsibility's Completion capability; Session owns no provider-specific compaction algorithm.

`createSessionCompactionWorkflow()` accepts `SessionCompactionWorkflowInput`: `agentId`,
`compactionInput` (`sessionId`, optional `branchId` and `target`), and optional invocation-local
`traceEmitter`. Its state retains only these explicit inputs and compaction working data. Run it with
bound Session/Actor/counter resources and `run({ input, signal })`, without constructing an Agent.
`defineCompactSessionInput()` owns closed business-input validation for both the Workflow and
standard Operation: unsupported fields, arrays, non-plain objects and accessors fail with
`SESSION_COMPACTION_INVALID` without invoking getters. Identifier failures retain their Session
identifier error codes. The Workflow validates before any condition (including custom skips) and
revalidates before constructing state, supplying detached, frozen business input and target objects.
Steps use the current Core `context.signal`. Standard composition owns
`SessionCompactionAgentRunContext`, projects this input and applies the outcome to its Agent Run.

```ts
const workflow = createSessionCompactionWorkflow({
  resources, // Explicit Session, Responsibility, token counter, instructions, policy and clock.
  condition: createShouldCompactSessionCondition(),
  stepOverrides: createDefaultSessionCompactionStepOverrides(),
});
const outcome = await workflow.run({
  input: { agentId, compactionInput: { sessionId, target: { maxTokens: 1024 } } },
  signal,
});
```

Standard composition installs the Compaction deadline through its Agent Operation executor. Direct
Workflow callers own that surrounding boundary and pass its effective signal; the Core Workflow
factory does not automatically install an Agent Operation policy or map its timeout errors.

Compaction borrows a `TokenCounter<TextTokenInput>` from Model Invocation Core. Resources supply
either `tokenCounter` or `resolveTokenCounter(signal)`, never both. The replaceable
`resolveCompactionTokenCounter` Step freezes the binding for candidate planning. Official Agent
composition resolves the counter from the foreground Responsibility's selected consuming Actor,
not from the summary-generating Actor; explicit host wiring can override that selection.
No encoding inference or character/token fallback is supplied. Missing capability fails eligible compaction with
`SESSION_COMPACTION_TOKENIZER_NOT_CONFIGURED` but does not prevent ordinary foreground interaction.
Counting/identity failures use `SESSION_COMPACTION_TOKENIZER_FAILED`; estimated results fail with
`SESSION_COMPACTION_MEASUREMENT_INEXACT`. Publication resolves the canonical binding again, rejects
identity drift and recounts exact final text, even when candidate validation is overridden.
The counter is borrowed and never closed by a Workflow.
This budget is not a claim about full provider chat-template/context-window cost.

`SessionCompactionPolicy` separates token acceptance from generation/source character safety guards.
Defaults are 4096 context tokens, target ratio .8 with no reserve, three generations including the
first, retry safety factor .9, minimum planner target 1, 65536 generation characters, and the configured
whole-turn source limits. `CompactSessionInput.target` optionally selects either `{ maxTokens }` or
`{ limitTokens?, ratio?, reserveTokens? }`. Calculated targets use floor(limit × ratio) − reserve.
Overrides never change policy or relax its token hard limit; invalid or contradictory values fail.

One Run freezes its source, exact branch boundary, target and tokenizer binding. The at-most-once
`buildCompactedContext` Composite invokes repeatable `prepareCompactionAttempt`,
`generateCompactionCandidate`, `measureCompactionCandidate`, `validateCompactionCandidate` and
`refineCompactionPlan` Steps. Complete oversized candidates are Run-local drafts; the next prompt
contains the fixed original reference and at most the current draft. Empty/truncated or interrupted
output is not reused. No partial candidate is persisted. This is an explicit domain loop, not a
Workflow Executor retry policy, and overrides remain ordinary Step Registry entries.

The final acceptance target T remains fixed. The default feedback Step tightens soft planner target P
using max(minimum, floor(min(P, measured F) × T/F × retrySafetyFactor)) for an oversized candidate.
Custom feedback can choose any valid soft target within configured bounds; the heuristic is not
baked into the Composite. The model may ignore a target or lose facts: deterministic validation proves
completion/size constraints, not semantic completeness. Exhaustion uses
`SessionCompactionAttemptsExhaustedError` with stable code `SESSION_COMPACTION_ATTEMPTS_EXHAUSTED`,
generation count, rejection reason, target and available actual token count, without summary text.
Provider/protocol/tokenizer/configuration failures are terminal, not automatic retries.

Only accepted output reaches `persistCompaction`, which independently remeasures the final text and
checks its target before one authority/CAS commit. Replacing a validator does not bypass publication
limits. Conflicts and storage failures do not regenerate or blindly retry writes. Raw turns are
unchanged; failed builds leave the old projection intact. Once non-cancellable commit I/O starts,
cancellation/failure may leave a committed projection: ordinary cancellation after an acknowledged
successful write preserves success, while an owned expired deadline still reports timeout.
Inspect authoritative state before deciding
whether to run again, never infer rollback from a rejected invocation.

Resources bind once at Workflow construction; working state is isolated per Run. Standard composition
uses `bindAgentWorkflow()` and the existing Operation execution boundary to apply
`SessionCompactionPolicy.timeoutMilliseconds` across the whole invocation, without resetting it for
new candidates. The default is `NO_SESSION_COMPACTION_TIMEOUT`. Only an owned deadline maps to
`SESSION_COMPACTION_TIMEOUT`; parent cancellation maps to `SESSION_COMPACTION_CANCELLED` and a
narrower Actor deadline remains `ACTOR_INVOCATION_TIMEOUT`. Direct native Workflow consumers own their
outer deadline boundary and pass its effective signal to `run()`. Session lifecycle cleanup releases
admitted execution leases without closing bound ports. Foreground requests never trigger compaction
implicitly.

This durable profile intentionally retains a bounded navigation surface. Branch merge, rename,
delete, pruning, retention, cross-Session clone, backup policy, encryption, automatic compaction
scheduling, and distributed coordination remain separate capabilities. SQLite executions stay busy
across restart; opening a database never rewrites active turns. Explicit recovery revokes credentials
and fails interrupted work. A runtime using Request Journal must use the local adapter profile's
coordinated `maintenance` capability to reconcile both domains before reopening admission; Session
recovery alone does not certify Journal recovery.

The core contract remains storage-agnostic. Future file, product-database, or Pi Session adapters can
replace these implementations without exposing their types to request or workflow logic.

## Source organization

`src/index.ts` is the package API. Features own explicit named entries, and public Workflow APIs
are exposed through their enclosing feature. Cross-feature consumers use those entries; shared
ancestor contracts and capabilities are explicitly declared in the source-boundary checks.

Independent type aliases and interfaces follow the repository's
[type placement convention](../../../../docs/standards/code-standards.md#type-and-interface-placement):

| Owner                                                                                 | Pure-type paths                                |
| ------------------------------------------------------------------------------------- | ---------------------------------------------- |
| Shared identity, reference, Turn and snapshot contracts                               | `contracts/types/`                             |
| Package error codes and capability combinations                                       | `types/errors.ts`, `types/session-ports.ts`    |
| Turn write requests                                                                   | `turns/types.ts`                               |
| Lifecycle management, queries and state                                               | `lifecycle/types/`, `lifecycle/state/types.ts` |
| Execution leases, fences, ports and recovery                                          | `lifecycle/execution/types/`                   |
| Navigation commands, outcomes, ports and coordinator inputs                           | `navigation/types/`                            |
| Navigation invocation state                                                           | `navigation/execution/types.ts`                |
| Compaction policy, projection, input/output, source, assessment and counter resources | `compaction/types/`                            |
| Planning target                                                                       | `compaction/planning/types.ts`                 |
| Workflow invocation contracts                                                         | Each Workflow's `types.ts`                     |
| Bounded queries and normalized paging inputs                                          | `query/types/`                                 |
| Metadata writes and Turn presentation                                                 | `metadata/types.ts`, `presentation/types.ts`   |
| Context Memory coordination records and navigation                                    | `context-memory/types/`                        |

These responsibility directories do not introduce new feature boundaries or automatic public APIs.
Features never depend back on the package's capability combinations. Their Workflow implementations
require only inspection/navigation or inspection/compaction capabilities. The package-level Workflow
resource and Context types retain full Session capabilities by default for existing custom Steps.
Factories preserve the supplied resource type in overrides, conditions, executors and lifecycle
hooks, including additional capabilities. Generic Context/options types accept an explicit resource
type, and generic resource types accept a narrower Session port when needed. Default-Step and
definition helpers accept the same resource type parameter. Package-level compatibility types live
in `types/session-workflows.ts`; feature implementations do not depend on them.

Runtime capability predicates live in `supports-execution.ts`, `supports-memory.ts` and
`supports-presentation.ts` within their owning features. Query limits have their own `limits.ts`.
Controlled Step names, Memory record kinds and compaction rejection reasons retain their derived
unions next to their runtime options. Small implementation-specific types, such as a feedback
function's input, a source selector's result, finalization context and error-constructor details,
remain with that implementation.

Shared lineage decisions live in `src/lineage.ts`; navigation snapshot projection stays with
navigation. Navigation's `execution/` capability owns command parsing and validation/inspection/
commit phases, shared by the direct coordinator and optional Workflow. Lifecycle management
composes its shared state authority and execution child through their public entries.

Compaction separates its outer Workflow plan and registry from registered Step implementations.
Preparation and publication Steps live in `workflow/steps/`; `build-compacted-context/` owns the
bounded candidate loop and its repeatable Steps. Step cardinality stays authoritative in
`step-definitions.ts`. Target resolution and feedback remain planning responsibilities; token
measurement belongs to the enclosing compaction feature.
