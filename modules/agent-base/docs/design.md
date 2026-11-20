# Agent Base design

## Purpose

Agent Base is our own understandable starting point for agent products and experiments. It is not
an attempt to make a universal framework that replaces every other agent framework.

It exists to provide:

1. a minimal agent identity, configuration, and resource-management layer;
2. explicit composition from replaceable Workflows and Steps;
3. a familiar composition root that we can inspect and modify without first reverse-engineering a
   third-party application;
4. thin wrappers over mature Pi capabilities so that we do not reimplement provider calls, tool
   loops, streaming, session trees, or compaction without a concrete reason.

The result should contain as little hidden machinery as possible. Replacing one Step, a composite,
an adapter, a Workflow, or the complete plan must all be normal supported operations.

## Non-goals

Agent Base is not:

- a replacement for Pi;
- a universal plugin marketplace or workflow engine;
- an owner of model training, model surgery, or application-specific policy;
- a reason to introduce inheritance-heavy framework abstractions;
- a service assembled independently inside every CLI, web client, or consumer.

## Pi boundary

Pi is the preferred default engine for commodity agent execution:

- provider and model invocation;
- the bounded agent/tool loop;
- streaming and execution events;
- context transformation and request hooks;
- session navigation, branching, and compaction;
- default local session persistence.

Pi must sit behind Agent Base adapters. Agent Base public contracts must not expose Pi-owned types.
This preserves the ability to replace Pi at a particular boundary without redesigning the rest of
the agent.

Pi hooks may customize the inner model/tool loop. They do not define the complete outer workflow.
Agent identity, resources, cross-session data, durable product transactions, background work, and
post-turn policies remain visible Agent Base or product-level concerns.

## Package, application, and runtime model

Agent Base keeps low-level runtime construction, application management composition, concrete
profiles, and process delivery separate:

```text
domain and adapter packages
  identity, config, Session, Request, Pi and storage boundaries
                         │
                         ▼
base-runtime → workflow-core
  Agent Operations and bindings → domain-independent execution
                         │
                         ▼
base-composition
  runtime/                       management/
  Standard single-Agent          ManagedAgentCompositionDefinition
  runtime composition            + narrow Domain Services
                         │
                         ▼
base-standalone-agent
  concrete bootstrap, directory and shared-SQLite profiles
                         │
                         ▼
applications and clients
  CLI, API, server or UI delivery
```

Domain and adapter packages are passive libraries. They do not start listeners, own a process
lifecycle, or silently choose product policy.

`composition/runtime` owns the official Standard single-Agent assembly. Its ground-level
`composeAgent()` selects one coherent set of runtime resources and rules and returns the actual raw
Agent. Correct Operation behavior must not depend on another facade. The optional transparent
`AgentAPI` only projects named convenience methods and always exposes that same Agent.

`composition/management` is a peer feature, not a wrapper around the Standard runtime. One immutable
`ManagedAgentCompositionDefinition` is the code-level source of truth for Config decoding,
namespace publication, authority ports, runtime-port creation, runtime materialization, optional
Projection, and optional out-of-band Session management. It does not perform I/O when defined.
Callers create only the narrow Service they need; each Service method creates only its scoped ports,
and only `AgentRuntimeService.open()` materializes a raw Agent.

Runtime opening first acquires Identity/Config authority ports and validates their snapshots. The
runtime Port factory then receives `{ namespace, identity, config }` with those typed snapshots
and revisions. The materializer receives their exact Identity and Config values plus the resulting
ports, without rereading authority or receiving namespace/revision metadata. This is one read result
reused across provisioning and assembly, not a cross-authority atomic snapshot. Profile code decides
whether Config affects resource generation; persistent authority is not implicitly keyed by Config
revision. Other Services retain narrower dependencies and do not acquire authority ports unless
their own operation needs them.

The framework does not require an `AgentApplication` instance. A long-running host may retain an
opened Agent or aggregate Services for convenience, but that host-owned object is neither a new
authority nor a correctness dependency. `@print-an-agent/base-standalone-agent` binds the generic
Definition and Services to concrete profiles. The CLI consumes those narrow Standalone Services or
the opened raw Agent and must not repeat their composition.

Official profiles own resource provisioning. A caller-owned Memory setup compiles one resource
Blueprint and retains all of its isolated allocation Scopes. Stage prepares Identity/Config Ports
before exposing its namespace handle, keeping the generic authority factory synchronous. The same
Scope lazily supplies one complete coordinated Session/Request Journal/maintenance persistence per Agent,
shared by runtime and out-of-band consumers. Memory Identity/Config authorities are revisioned but
ephemeral, not a runtime cache. Reopening Agents or updating Config does not replace their Session
authority. Directory/shared-SQLite factories may reopen different adapter instances against the
same durable authority. Live sharing depends on provisioning scope, not universal Definition object
identity. Resource Registry is optional Profile infrastructure, not a new generic Service dependency;
ordinary consumers use the canonical Definition and narrow Services. The Host retains setup for all
live consumers, drains business work before close, and preserves cleanup failure independently of
business commit facts. Failed unpublished allocations remain owned until confirmed cleanup.

Workflow and Service are different roles. A Workflow implements and orchestrates capability
execution using explicit resources; it does not know the Profile or Resource Registry. An application
Service is an entry/coordinator: it may validate/resolve a target, acquire the capabilities needed
for this operation, invoke Workflows or public Service capabilities, and project the result. There
need not be one Service per Workflow. Explicit Service composition is allowed; stealing another
Service's internal adapter or independently recreating the same authority is not.

Generic management/application Services use the Definition's narrow typed factories/resolvers and
do not choose concrete Tokens, bindings, Scope or adapter recipes. Profile-specific assembly or
resource-resolution Services may directly hold Registry: executing that Profile's resource recipe
is their responsibility. This permission follows the layer's role, not the word `Service` in its
name. Registry remains optional implementation infrastructure for a provisioner, not a replacement
for all provisioning contracts or a reason to introduce a universal resource-access facade.

Acquiring a capability is not owning it. Neither kind of Service gains `Scope.close()` responsibility
by holding a resolver/Registry. Host/Profile still retains the owner, stops admission, cancels/joins
business work and closes acquisitions. For a registered Service that retains a dependency through
release, that dependency must be declared in the Provider graph; a resolver closure alone does not
record a cleanup edge. External dependencies require an explicit owner retaining their full lifetime.
The [Registry consumption contract](../packages/composition/docs/resource-registry/consumption.md)
and executable independent Service example specify these boundaries without changing raw Agent,
Session authority or any business feature.

Official Standalone bootstrap follows that same Definition/Service path: create namespace and
Identity/Config authority, then open a raw Agent. Bootstrap requires a caller-owned setup;
SQLite bootstrap uses the shared-SQLite profile. Durable creation and opening are distinct:
duplicate creation conflicts, opening reads existing authority, and Config replacement is an
explicit revision-checked management operation. The Standalone materializer requires complete
Session/Journal Ports and returns raw Agent; optional API facades are explicit caller choices.
Lower-level runtime composition retains its independent defaults and hackable assembly surface.

### Composition vocabulary

`Definition` is a general code-contract suffix, not a concept owned by one architectural layer. The
complete name establishes its scope:

- `AgentDefinition` defines how `createAgent()` constructs one raw Agent from identity, resources,
  Operations, and observability;
- `ManagedAgentCompositionDefinition` defines how one Host/application family constructs and
  connects Config, namespace, authority, runtime, Projection, and optional management capabilities;
- `AgentConfig` is one Agent's durable, validated, normally JSON-like declaration. It contains no
  Adapter instance, database connection, Step function, Engine object, or other executable code;
- a Domain `Service` exposes a cohesive set of non-runtime application operations;
- a `Port` is a capability boundary, while an Adapter is one concrete implementation of that Port.

These concepts are not interchangeable. A managed runtime materializer may use the Standard
`composeAgent()` path, a product extension, or the lower-level `createAgent()` path. Generic
management requires only that it return the exact typed raw Agent; it does not require an
intermediate `StandardAgentDefinition` or assume the Standard `foreground` and `compactSession`
Operation names. Session navigation is an optional out-of-band management capability, not a
Standard raw Agent Operation.

Projection is an optional, one-way secondary view of authoritative Identity and AgentConfig. The
generic contract does not prescribe JSON, a file, a local filesystem, or any other external medium,
and Projection never becomes an implicit reverse-write path. Explicit Config import still passes
through the Definition's Config Codec and revision/CAS authority. Out-of-band Session management is
likewise an optional typed capability rather than a hidden requirement of every Definition.

Management mutation results distinguish the authoritative commit from Projection coordination. A
successful Identity or Config mutation returns the exact committed authority snapshot together with
the Projection outcome. Projection failure is a safe, explicit secondary outcome: it neither rolls
back authority nor turns the commit into an exception. Product-owned coordination that follows the
commit, such as reconciling a runtime host, remains outside Agent Base and must settle independently
from Projection so that neither secondary failure hides the other.

Agent and Session management operations accept optional execution cancellation without adding
`AbortSignal` to domain inputs or persistence documents. Services check cancellation before resource
preparation and again after asynchronous preparation, immediately before the stateful adapter
boundary. Once an adapter mutation begins, the framework waits for its real outcome and never uses a
promise race to report cancellation while storage may still commit. This is a cooperative pre-commit
boundary, not a claim that every injected adapter operation can be interrupted.

## Runtime hierarchy

Request orchestration does not require that hierarchy for every consumer.
`createSessionlessRequestWorkflow()` runs a real Core Workflow directly over a borrowed Actor and
caller-supplied messages, using direct generation, single-generation streaming, or bounded
Interaction. It creates no Agent/Session/Journal authority and performs no implicit conversation
persistence. Host code owns configuration resolution and optional whole-call deadlines.

Session-aware foreground and Sessionless Workflows own different plans/state/results while sharing
semantically identical narrow-context Steps and execution helpers. Session/replay admission, commits,
trace projection and response metadata stay in the Session-aware domain. No parent Response
Workflow, universal Context, second model protocol or alternate tool loop is introduced. See the
[Sessionless request guide](../packages/request/docs/sessionless.md).

```text
Agent
  → Agent Operation
      → Agent Run
          → Workflow
              → Step
```

The levels have deliberately different responsibilities. Agent, Agent Operation, and Workflow are
reusable run-stateless definitions. Agent Run Context and Workflow Context contain mutable execution
state.

## Agent, Agent Operation, and Agent Run Context

An Agent is the sole reusable owner containing:

- agent identity;
- global resources and adapters;
- one immutable heterogeneous Workflow Catalog;
- one immutable heterogeneous Agent Operation Catalog.

An Agent Operation is a static named executable capability. It declares public or internal exposure,
typed input/output, local config and resources, an Agent Run Context factory, an explicit ordered
Workflow Plan, and the exact other Operations it may invoke. Optional bounded Run preparation and
terminal error mapping keep input normalization, signal policy, and public failures inside the
Operation rather than an outer API facade. An Operation does not need an LLM.

Every `agent.invoke()` creates exactly one Agent Run with an isolated Context, Run ID, signal, trace
lifecycle, and result. The Context is shared only by the Workflows selected by that Operation and is
the explicit place for cross-Workflow state.

```ts
interface BaseAgentRunContext {
  readonly identity: AgentIdentity;
  readonly operationName: string;
  readonly runId: string;
  readonly parentRunId?: string;
  readonly input: unknown;
  output?: unknown;
  readonly signal: AbortSignal;
  readonly operations: AgentOperationInvoker;
}
```

Operation config and local resources are passed to the Agent Run Context factory. The product
decides which of them to expose on its extended Context. Agent Base never creates a global database
or provider.

The Agent never runs every Workflow implicitly. It invokes one selected public Operation; that
Operation executes only its fixed plan. Internal Operations are not externally invocable.
Operation-to-Operation visibility is deny-by-default: a Run receives only a narrowed invoker for
references its definition declared. Child calls create distinct correlated Runs, inherit
cancellation by default, and fail closed on undeclared targets or invocation cycles.

## Identity

`@print-an-agent/base-identity-config/identity` defines the smallest shared identity value:

```ts
interface AgentIdentity {
  readonly id: AgentId;
  readonly displayName: string;
}
```

`AgentId` is a validated opaque logical namespace. It is the stable key used by config, sessions,
and resource adapters. It is not a filesystem path, provider name, model ID, or database locator.
`displayName` is presentation metadata and must never be used as storage authority.

The reusable Agent holds one immutable identity value, and every Agent Run receives that exact value
in its Context. Identity Catalog ports own active/disabled lifecycle snapshots, independent CAS
revisions, and ordered discovery. Memory and SQLite adapters from
`@print-an-agent/base-local-adapters` implement the same contract. Agent IDs
cannot change, and no hard-delete contract exists. Import, clone, migration, and product identity
semantics remain outside this generic lifecycle.

## Configuration

`@print-an-agent/base-identity-config/config` owns configuration ports and lifecycle semantics without owning a storage
implementation or a universal product schema:

```text
AgentIdentity
  + raw AgentConfigSnapshot from adapter
  + product AgentConfigCodec
  → validated ResolvedAgentConfig
  → assembled Agent
```

The product owns its typed config and codec. The read/write adapter handles only JSON-compatible
documents keyed by `AgentId`. It cannot choose defaults or interpret Workflow, provider, session,
or product fields. This lets a composition root use a file, SQLite, remote service, or test adapter
without changing Agent or Workflow code.

Every stored config has a positive schema version and monotonic revision. Writes use explicit
compare-and-swap: `expectedRevision: null` creates an absent document, while a number replaces only
that exact revision. Defaults are validated through the same codec as stored data, but resolving a
default does not silently persist it. Persistence is always an explicit write.

`@print-an-agent/base-local-adapters` supplies the deterministic Memory implementation and the opt-in
SQLite implementation with versioned durability, defensive decoding, size limits, restart
isolation, and CAS. Config values are validated as closed JSON trees before reaching either adapter.
Session state still uses its own port; a composition may place both adapters' independent tables in
one SQLite database without merging their authority.

Generic port-owning packages do not also own the official local implementations.
`@print-an-agent/base-local-adapters` contains reusable Memory, SQLite, local OutputSink, and bounded trace
implementations and depends on the domain packages whose ports it implements. Domain packages never
depend back on it. Standalone-owned namespace publication and manifest projection remain in the
Standalone package, while Pi-backed Engine implementations remain in `@print-an-agent/model-invocation-pi`.

SQLite physical names belong to concrete adapter construction. Each adapter independently owns its
typed prefix/override input, identifier validation and quoting, table keys, migrations, SQL,
lifecycle, and error mapping; no generic SQLite naming contract sits below them. Neutral defaults use
`agent_`. Standalone TypeScript profiles may forward one host policy and validate cross-domain
collisions, but Agent configuration, managed manifests, Workflow Context, and runtime requests never
carry table names.

## Workflow and Workflow Context

Workflow execution belongs to `@print-an-agent/workflow-core`, not Agent Base. A reusable `Workflow`
contains a stable name, bound borrowed resources, an optional condition, one entry Step, Step
definitions/overrides, state creation, result projection, lifecycle hooks, and an optional Step
executor. It returns `TResult`
directly; it knows nothing about Agent identity, Operations, result application or persistence.

Each invocation receives a framework-owned context:

```ts
interface WorkflowContext<N extends string, S, R> {
  readonly state: S;
  readonly resources: R;
  readonly workflowName: string;
  readonly workflowRunId: string;
  readonly parentRunId: string | undefined;
  readonly signal: AbortSignal;
  readonly runStep: (name: N) => Promise<void>;
  readonly parallel: (names: readonly N[]) => Promise<void>;
}
```

`@print-an-agent/base-runtime` supplies
`bindAgentWorkflow({ workflow, projectInput, applyResult })`.
The Core Workflow's factory binds prepared resources at construction, alongside Step configuration.
The required synchronous `projectInput` selects the Core input from each Agent Run; the Workflow's
input type is independent of the Agent Run type. The binding separately supplies cancellation and
correlation, and projects metadata to Agent tracing. It does not run Steps,
assemble business state, or acquire/close resources. Its result exposes `applyTo`, which refuses
a different Agent Run Context. Agent Operation orchestration applies that result explicitly.
Workflow Plans and Catalogs contain these bindings; one binding may be shared by compatible Operations
that intentionally use the same bound capabilities. Each invocation retains its own state, result,
signal and trace correlation. Different stores require separately assembled Workflows.

The binding rejects top-level Promise/thenable projection results before Core admission with
`WORKFLOW_INPUT_PROJECTION_ASYNC`, even for broad input types. It observes native Promise rejection
without awaiting invalid work or invoking custom thenable methods. Synchronous projection exceptions
retain their original identity.

Request and compaction return `undefined` from `createSkippedResult` to preserve the existing Agent
output on a condition skip. For an executed run, `createResult(state)` requires the completed
response or compaction outcome.

Each Workflow's `createState` converts its projected input into the business data exposed under
`context.state`. Request uses a narrow `RequestWorkflowInput` with its business input, agent/request identity and an
optional invocation-local trace emitter. Compaction similarly accepts `SessionCompactionWorkflowInput`
with its agent namespace, compaction input and optional trace emitter. Neither state retains an Agent
Run, its output, operation invoker or inherited signal. Composition owns their Agent Run types and
input projections.
Other Workflows may select or transform the input into an independently defined state shape.
Ports and policies are in `context.resources`. The effective `context.signal`
may additionally include a parallel group's cancellation; pass it explicitly to adapters and child
Operation invocations. The Agent Run's own signal remains owned by its Operation.

Core tracks admitted Steps and drains them before hooks. Await `context.parallel(names)` when
parallel children use a parent-owned resource: it cancels peers on failure and joins all children
before the parent's cleanup. Resource ownership is never inferred from context references.
Metadata observers are isolated and not awaited; the Agent trace emitter owns delivery sequencing.
Safe failure classification is supplied by the binding, including recovered child failures.

## Workflow Catalog, override registries, and conditions

The Agent owns one immutable heterogeneous Workflow Catalog assembled from its Operation plans.
The same Workflow object may appear in multiple plans, but two different definitions cannot reuse
one name. An Operation plan stores exact Workflow references, so construction does not require a
mutable or two-phase parent catalog.

The separate Workflow Registry utility remains available to composition code and distinguishes two
skip authorities:

1. Agent configuration may set a registered Workflow to `SKIP_WORKFLOW`. This is permitted only
   when its registration is `skippable: true`.
2. An active Workflow may return a skip decision from its own condition because it is not applicable
   to the current Agent Run Context.

Configuration skip prevents the Workflow from being invoked at all. Internal condition skip is a
run-time domain decision made by the Workflow itself. Required Workflows cannot be disabled by
configuration, but they may still define an honest applicability condition.

Unknown overrides, missing implementations, name mismatches, and illegal skips fail during registry
resolution. Agent construction validates Operation registration, exact callable references, and
Workflow name uniqueness before any Run begins.

## Step model and registry

Every execution unit inside a Workflow has the same shape:

```ts
type Step<C> = (context: C) => Promise<void>;
```

A leaf Step handles one explicit replaceable concern. A composite Step calls other Steps. The Workflow
entry is the top-level composite Step. These are semantic distinctions, not separate runtime types.
A Step is an override unit, not a requirement to fragment every internal operation into another Step.

The canonical request composition is:

```text
request Workflow
└── runRequest
    ├── prepareRequest
    │   ├── validateRequest
    │   ├── resolveSession
    │   ├── resolveRequestReplay
    │   ├── beginRequest
    │   ├── resolveExecutionTarget
    │   ├── resolveInstructions
    │   ├── loadSessionContext
    │   ├── gatherExternalContext
    │   ├── buildTools
    │   └── buildModelContext
    └── executeRequest
        ├── runAgentInteraction
        │   ├── openResponseStream
        │   ├── invokeActorInteraction
        │   │   └── dispatchInteractionEvent (per accepted event)
        │   │       ├── deliverTextDelta (text-delta)
        │   │       ├── deliverReasoningDelta (reasoning-delta; optional)
        │   │       ├── captureReasoningPresentation (reasoning-delta; optional)
        │   │       ├── buildTurnPresentation (assistant-complete; optional)
        │   │       └── completeAssistantMessage (assistant-complete)
        │   └── buildAgentResponse
        └── completeResponse
```

`executeRequest` owns both streaming and non-streaming publication. Any transformation or validation
that affects what the user sees belongs inside that composite before or during publication. There is
no required `finalizeRequest`: request and tool events are persisted through adapters when they occur,
not collected for a final fictional commit.

`afterResponse` is a separate optional background Workflow for application work that starts after the
visible response closes. Long-running work
should receive a new Agent Run and Context rather than continuing to mutate the foreground request
Context.

Composite Steps resolve every child through the current Workflow Context. They never call a captured
default directly. This makes leaf, composite, and complete entry overrides propagate through the
unchanged surrounding Workflow.

The official interaction composite owns bounded serialized event delivery, trace boundaries, and
Tool cleanup. All business phases above use the existing `runStep()` mechanism. The dispatcher and
text/reasoning delivery and reasoning capture are repeatable; Session completion and the other phases
are at-most-once. Reasoning delivery, capture, and presentation construction are optional and installed
by default; all other interaction phases are required.
The current event lives only through its awaited dispatch in the
shared Workflow Context, with a typed accessor; there is no second handler registry or child Context.

`RequestPolicy.maxPendingInteractionEvents` limits active plus queued events (default 64).
Backpressure is the returned emit Promise. Overflow or the first delivery failure aborts the
interaction, rejects further work, discards queued events, and drains active delivery before failure
cleanup. The Actor boundary closes its emitter when the Engine settles, observes unawaited delivery,
and withholds the terminal message until result parity and pre-terminal delivery succeed. Request
output accounting and event tracing precede replaceable dispatch. Cancellation remains cooperative;
started external side effects are not rolled back. Replacing the complete interaction composite is
an explicit replacement of these orchestration responsibilities, not a way to retain them implicitly.

`OutputStreamEvent` distinguishes readable `reasoning-delta` from final-answer `text-delta`.
Reasoning from every model turn passes through the registered `deliverReasoningDelta` Step;
consumers may override it or use `SKIP_STEP`. Request-wide reasoning accounting precedes these
replaceable Steps: `maxReasoningCharacters` defaults to 64,000 UTF-16 code units and overflow fails
with `MODEL_REASONING_LIMIT_EXCEEDED`, even if delivery is skipped. This budget is independent of
text output. Reasoning uses the same event integrity, ordered backpressure, cancellation, and drain
boundaries. It is not mixed into final text, replay, or future Session context. No direct-streaming,
reasoning-generation settings, or opaque signature forwarding is implied.

The standard composition also installs optional `captureReasoningPresentation` and
`buildTurnPresentation` Steps. Capture accumulates bounded display-only chunks per model turn,
independently of live delivery. Construction joins chunks within each block, preserving ordered
`modelTurnIndex`/`text` blocks rather than flattening across Tool iterations. Empty/filtered turns
create no blocks. After terminal/result validation, the Session adapter atomically commits the assistant
message, branch head, and prepared presentation through its optional `SessionPresentationPort`.
No partial delta is durably written. Missing capability with active capture fails at composition;
`SKIP_STEP` disables capture without a global Agent retention setting. Overrides can filter or redact
the captured value. The storage contract independently bounds one record to 64,000 UTF-16 code units
across at most 1,024 nonempty blocks;
no Step override silently bypasses commit validation. Presentation queries are exact and explicit,
separate from model context, compaction, and ordinary turn-ledger reads. A later output/Journal failure
does not roll back an already committed Session turn. Memory/SQLite are implementations, not required
infrastructure or defaults selected by the Session domain package.

## Step Registry and overrides

Every registered Step has a policy-bearing definition:

```ts
interface StepDefinition<C> {
  readonly step?: Step<C>;
  readonly skippable: boolean;
  readonly cardinality: StepCardinality;
}

const STEP_CARDINALITY = Object.freeze({
  AT_MOST_ONCE: 'at-most-once',
  REPEATABLE: 'repeatable',
} as const);

type StepCardinality = (typeof STEP_CARDINALITY)[keyof typeof STEP_CARDINALITY];
```

An override can inherit, replace, skip, or explicitly change invocation policy:

```ts
const stepOverrides = {
  getSystemPrompt: undefined, // use the registered default
  gatherContexts: customStep, // replace it
  selfReflection: SKIP_STEP, // deliberately skip it
  processItem: { cardinality: STEP_CARDINALITY.REPEATABLE }, // inherit its implementation
  publishProgress: { step: SKIP_STEP, cardinality: STEP_CARDINALITY.REPEATABLE },
};
```

The Step Registry is resolved when its Workflow is created, not separately by each run. Unknown
overrides, registered Steps without an implementation, attempts to skip a required Step, and a
skipped or missing entry Step fail during Workflow creation. A dynamic call outside the resolved
registry fails explicitly at run time.

Structured overrides accept only `step` and `cardinality`; omitted fields inherit the definition.
Function shorthand replaces behavior while retaining policy. The original definition owns
`skippable`. `mergeStepOverrides()` composes override layers field by field so changing a policy does
not discard the installed default implementation. Resolved registry entries are frozen and retain
the effective cardinality and skip policy even when skipped.

An explicitly skipped Step remains represented in the resolved registry. Calling it through
`runStep` performs a deliberate no-op and records one skipped invocation. This is different from an
absent Step.

### Step invocation policy

A Step is a named, replaceable, composable execution unit. Cardinality belongs to its registration
and is enforced over `(workflowRunId, stepName)`, not over a function object or its parent Step.
Every definition explicitly declares its policy. Official preparation, execution, and commit phases
use `AT_MOST_ONCE`; request event dispatch and text delivery use `REPEATABLE`. Callers can explicitly
override that policy when defining another execution plan.

`AT_MOST_ONCE` permits zero or one logical invocation. Success, failure, and skip all consume it;
another call fails with `STEP_CARDINALITY_EXCEEDED`. `REPEATABLE` permits another invocation after
the preceding one terminates. Both reject same-name overlap or reentrancy with
`STEP_CONCURRENT_INVOCATION_NOT_ALLOWED`, checked before cardinality. The runtime reserves the name
before its first await and releases the running state in `finally`, including trace failure paths.
Rejected calls do not enter the executor or produce started/failed lifecycle events.

State is private to each Workflow Run. Parent invocation does not reset children, and no static rule
forbids a repeatable parent from conditionally calling an at-most-once child. Different Step names
are not mutually exclusive: implementations still own safety when sharing mutable Context.

The Step lifecycle surrounds one logical invocation, not each implementation attempt. A custom
executor may invoke the implementation multiple times inside that invocation; the built-in executor
does so once. There is no built-in retry, attempt counter, automatic rollback, or idempotency claim.
A future Workflow retry starts a new Run without undoing the preceding Run's business side effects.

## Run lifecycle

One execution follows a deliberately small sequence:

```text
1. Caller selects one public Agent Operation and supplies typed input plus an optional AbortSignal.
2. Agent creates one Agent Run ID, narrowed Operation invoker, trace emitter, and Run Context.
3. Agent executes each exact Workflow reference in the Operation's fixed ordered plan.
4. Core evaluates its internal condition. A skip projects its result and returns without running Steps.
5. An active Workflow creates run-local state and invokes its entry Step.
6. Nested Steps share state and resources with scope-local runners and effective signals.
7. Core drains admitted work, runs success hooks and projects the result from state. After cleanup,
   the Agent binding can apply the returned result.
8. After the plan completes, Agent requires and returns the Agent Run Context output.
```

Each Workflow's Step Executor wraps every active Step invocation, including nested ones. It is the
seam for tracing, timing, permissions, and execution-wide mechanics within that Workflow.

The implemented runtime deliberately does not add retries, event middleware, transaction management,
background-job semantics, or a Condition Registry. It detects Operation invocation cycles because
cross-Operation calls are an explicit runtime graph. Named replaceable Conditions should be added as
concrete Steps reveal them.

Workflow Runtime does provide `onSuccess`, `onError`, and guaranteed `onFinally` handlers after an
active Workflow Context has been created. `onError` receives the original execution or success-hook
failure. `onFinally` runs even when execution or `onError` fails. If lifecycle handlers also fail, an
`AggregateError` preserves the original failure and every handler failure in deterministic order.
Condition-skipped Workflows create no Workflow Context and invoke no lifecycle handler. These are
runtime mechanics rather than ordinary Steps; individual Steps remain responsible for local recovery
and local resource cleanup.

## Invocation vocabulary

- **Agent Operation**: static named executable capability definition owned by one Agent.
- **Agent Run** (`agent.invoke()`): one Operation invocation across its explicit Workflow Plan.
- **Workflow Run**: one named Workflow with one Workflow Context.
- **Request Workflow**: foreground `prepareRequest -> executeRequest` processing.
- **Agent Loop**: inner bounded model/tool loop used by `runAgentInteraction`, normally delegated to
  Pi. It is not the complete Agent lifecycle.
- **Actor interaction**: bounded Agent Loop invocation whose Engine may declare streamable normalized
  events.
- **Actor direct invocation**: one buffered bounded completion without a tool loop.

The independent `model-invocation` module owns Actor/Engine contracts and model protocols. Agent Base
consumes those capabilities and adds tool permissions and Responsibility routing. A Workflow selects
an Actor by Responsibility; a plain Completion consumer does not need an Agent or Agent Loop.

## Storage model

Storage is always a replaceable adapter or an explicitly injected resource. Agent Base must not
hard-code a database connection.

Pi SQLite is a suitable default for ordinary session and chat persistence. Its standard schema can
store Pi session entries and opaque custom metadata. It does not by itself provide arbitrary
product tables or transactions spanning session writes and product authorities.

Products with stronger requirements may provide a composite adapter. A composite SQLite
implementation may deliberately share one connection to support product-owned transactions; that
remains an adapter decision, not an Agent Base assumption.

## Product integration

Products compose the existing Agent with application-owned configuration, adapters, workflows,
and model capabilities. Any integration with Model Workbench belongs to the consuming application;
Agent Base and Model Workbench remain independent.

## Design rules

- Keep Agent, Agent Operation, and Workflow definitions run-stateless.
- Keep mutable state in Agent Run Context or Workflow Context according to its lifetime.
- Make dependencies explicit in constructors, factories, and Contexts.
- Keep default composition readable from one source file.
- Execute only the selected Operation's explicit Workflow Plan; never iterate a catalog implicitly.
- Treat leaf, composite, and Workflow entry execution as the same Step abstraction.
- Resolve all nested Steps through the current Workflow Context's registry.
- Distinguish configuration skip from Workflow applicability conditions.
- Support replacement at leaf, composite, adapter, and whole-workflow granularity.
- Permit skipping only through `SKIP_STEP` and only for explicitly skippable definitions.
- Fail explicitly for missing, unknown, or illegally skipped Steps.
- Put Pi behind adapters and reuse it aggressively.
- Keep utility packages passive.
- Keep exactly one coherent composition owner for each assembled raw-Agent runtime path; do not
  confuse that runtime rule with the separate application-management Definition.
- Let applications host raw Agents and narrow Services; do not let delivery code redefine either
  runtime composition or management authority.
- Do not add abstraction until at least one concrete boundary needs it.

## Current implementation scope

The current foundation contains:

- `@print-an-agent/base-identity-config`: stable identity values, active/disabled catalog lifecycle,
  generic config codecs, JSON values, independent CAS revisions and injected storage ports. The
  `/identity` and `/config` entries preserve separate feature contracts in one package;
- `@print-an-agent/model-invocation-core`: Provider Model and credential references, an invocation-time credential
  resolver port, normalized text messages and usage, bounded Agent Loop events, execution targets,
  runtime ports, and structured failures;
- `@print-an-agent/base-session`: generic session/turn authority, navigation, and compaction behavior;
  separate Session lifecycle, execution-fence and optional purge/recovery contracts;
- `@print-an-agent/base-runtime`: single-owner Agent, typed Agent Operation and Run contracts, one
  heterogeneous Workflow Catalog, explicit Workflow Plans, invocation permissions, and typed
  result/trace bindings to the domain-independent `@print-an-agent/workflow-core`;
- `@print-an-agent/base-request`: the canonical
  `request Workflow -> runRequest -> prepareRequest/executeRequest` composition, stable Request Step
  names, fail-fast generic placeholders, concrete text-request Step overrides over injected ports, and
  the OutputSink lifecycle;
- `@print-an-agent/base-local-adapters`: official process-local Memory and durable SQLite implementations
  for Identity, Config, Session, Request Journal, OutputSink, and trace ports;
- `@print-an-agent/model-invocation-pi`: the isolated low-level Pi `0.82.1` loop adapter with one shared Actor runtime,
  a deterministic faux profile, exact builtin provider/model binding, and explicit text-only
  OpenAI-compatible endpoints;
- `@print-an-agent/base-composition`: the official Standard Agent owner with public
  foreground/compaction Operations plus storage-neutral Agent management, raw-runtime opening, and
  independent optional out-of-band Session management/navigation Services;
- `@print-an-agent/base-standalone-agent`: authoritative Memory/shared-SQLite bootstrap plus canonical
  Memory, per-Agent directory, and shared-SQLite reference profiles consumed through narrow
  Services or raw Agents by the CLI and other hosts.

Agent Runtime accepts a product's already resolved typed config. Workflow Core receives only explicit
input and borrowed capabilities; neither layer resolves or persists configuration itself.
The composition architecture is formal, but memory persistence remains
a development default for deterministic and ordinary-provider shortcuts. OAuth, durable credential storage,
dynamic provider catalog persistence, broad provider qualification, automatic failover, hard delete,
Agent ID rename, cross-root migration, and distributed lifecycle coordination remain bounded later
work.

## Session lifecycle boundary

Session retirement is a management capability, not an Agent Operation or Workflow. Query,
retire/restore, purge and execution protection are independently shaped ports owned by `base-session`.
The [lifecycle contract](../packages/session/docs/lifecycle.md) defines active/retired state, shared
metadata CAS, immutable adapter-generated Session IDs, non-expiring execution credentials, recovery and the
atomic purge scope. Pure guards do not perform persistence or acquire locks.

Lifecycle lists contain bounded summaries without execution-fence evidence; exact inspection adds
that evidence. Session purge/recovery own only the Session aggregate and execution state. Request
Journal cleanup/recovery remain request-owned. A managed profile may compose an atomic
Session-plus-Journal purge and continuously fenced recovery, but cannot claim those guarantees from
the Session ports alone or from sequential independent cleanup calls.

Official Memory and SQLite adapters are lifecycle-qualified across admission, writes, Request
Journal/replay, OutputSink finalization, compaction, navigation, purge, and recovery. Generic
application composition exposes Session management and navigation as independent optional typed
capabilities, and the Standalone profiles project them to host-facing string/JSON APIs. The CLI's
managed Session navigation and managed-directory `session lifecycle` commands consume those
projections without opening an Agent runtime or provider.
No lifecycle method is added to Agent, AgentAPI, Agent Operations, or Workflows.
