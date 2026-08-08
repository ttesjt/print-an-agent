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

## Package and runtime model

Agent Base has three kinds of deliverables:

```text
utility and adapter packages
  identity, workflow, config, resources, Pi adapters, storage adapters
                         │
                         ▼
assembled agent package
  one complete, self-contained composition with explicit defaults
                         │
                         ▼
applications and clients
  CLI, API, or UI delivery shells that call the assembled agent
```

Utility and adapter packages are libraries. They do not start listeners, own a process lifecycle,
or silently choose product policy.

The assembled agent package is the single composition root. It selects adapters, supplies all
required rules, and exposes a directly runnable agent API. This package is the final agent service
from the code-architecture perspective, even when a CLI or HTTP application hosts it in a process.

The Agent Base CLI must depend on this assembled agent. It must not repeat or fork the composition.
Another product may create a different assembled package from the same utilities.

## Runtime hierarchy

```text
Agent
  → explicit Workflow Plan
      → Workflow
          → Step
```

The four levels have deliberately different responsibilities. Agent and Workflow are reusable,
run-stateless domain objects. Agent Context and Workflow Context contain all mutable execution
state.

## Agent and Agent Context

An Agent is a reusable holder and orchestrator containing:

- agent identity;
- agent configuration;
- resources and adapters;
- a resolved Workflow Registry;
- a default Workflow Plan;
- an Agent Context factory.

The Agent does not retain mutable cross-request state. Every `run()` creates exactly one Agent
Context. That Context is shared across only the Workflows selected for the current run and is the
explicit place for cross-Workflow state.

```ts
interface BaseAgentContext {
  readonly identity: AgentIdentity;
  readonly runId: string;
  readonly input: unknown;
  output?: unknown;
  readonly signal: AbortSignal;
}
```

Configuration and resources are passed to the Agent Context factory. The product decides which of
them to expose on its extended Context. Agent Base never creates a global database or provider.

`run()` executes the configured default plan. `runPlan()` executes an explicit ordered plan, and
`runWorkflow()` is the single-Workflow convenience. Agent never runs every registered Workflow
implicitly.

## Identity

`@ta-agent/base-identity` defines the smallest shared identity value:

```ts
interface AgentIdentity {
  readonly id: AgentId;
  readonly displayName: string;
}
```

`AgentId` is a validated opaque logical namespace. It is the stable key used by config, sessions,
and resource adapters. It is not a filesystem path, provider name, model ID, or database locator.
`displayName` is presentation metadata and must never be used as storage authority.

The reusable Agent holds one immutable identity value, and every run receives that exact value in
its Agent Context. Storage-backed identity catalogs, rename policy, deletion, import, and cloning
are intentionally not guessed by this primitive package; those require resource-lifecycle
semantics that will be introduced with a concrete adapter.

## Configuration

`@ta-agent/base-config` owns configuration ports and lifecycle semantics without owning a storage
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

`MemoryAgentConfigAdapter` is the deterministic reference implementation. It demonstrates the
adapter contract and Agent isolation; it is not the production persistence decision. Session state
uses its own port and process-local memory adapter; durable configuration and session storage remain
separate later adapter decisions.

## Workflow and Workflow Context

A Workflow is a reusable class containing:

- its stable name;
- an internal runtime condition;
- one entry Step;
- Step definitions and overrides;
- a Workflow Context factory;
- a Step Executor;
- the rule that applies a completed Workflow result to the Agent Context.

Every Workflow execution creates an isolated Workflow Context:

```ts
interface BaseWorkflowContext {
  readonly workflowName: string;
  readonly workflowRunId: string;
  readonly agentContext: BaseAgentContext;
  readonly signal: AbortSignal;
  readonly runStep: (stepName: string) => Promise<void>;
  result?: unknown;
}
```

The Workflow Context owns temporary Step state. The Agent Context carries intentional cross-Workflow
state. A completed Workflow returns a typed result and an application function; Agent orchestration
then explicitly applies that result to the same Agent Context. Results cannot be applied to a
different run's Context.

`Workflow` is a class because it is a stable named domain object with encapsulated definitions and
behavior. `createWorkflow()` remains a convenience for consumers that prefer factory composition.
Subclassing is optional rather than the only extension mechanism.

## Workflow Registry, configuration, and conditions

The Agent Workflow Registry distinguishes two skip authorities:

1. Agent configuration may set a registered Workflow to `SKIP_WORKFLOW`. This is permitted only
   when its registration is `skippable: true`.
2. An active Workflow may return a skip decision from its own condition because it is not applicable
   to the current Agent Context.

Configuration skip prevents the Workflow from being invoked at all. Internal condition skip is a
run-time domain decision made by the Workflow itself. Required Workflows cannot be disabled by
configuration, but they may still define an honest applicability condition.

Unknown overrides, missing implementations, name mismatches, illegal skips, and unknown Workflows
in the default plan fail when Agent is created. Unknown names in a per-run plan fail explicitly at
run time.

## Step model and registry

Every execution unit inside a Workflow has the same shape:

```ts
type Step<C extends BaseWorkflowContext> = (context: C) => Promise<void>;
```

A leaf Step handles one explicit replaceable concern. A composite Step calls other Steps. The Workflow
entry is the top-level composite Step. These are semantic distinctions, not separate runtime types.
A Step is an override unit, not a requirement to fragment every internal operation into another Step.

The agreed initial request composition is:

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
        └── completeResponse
```

`executeRequest` owns both streaming and non-streaming publication. Any transformation or validation
that affects what the user sees belongs inside that composite before or during publication. There is
no required `finalizeRequest`: request and tool events are persisted through adapters when they occur,
not collected for a final fictional commit.

`afterResponse` is a separate optional background Workflow for product work that starts after the
visible response closes. Long-running work
should receive a new Agent Run and Context rather than continuing to mutate the foreground request
Context.

Composite Steps resolve every child through the current Workflow Context. They never call a captured
default directly. This makes leaf, composite, and complete entry overrides propagate through the
unchanged surrounding Workflow.

## Step Registry and overrides

Every registered Step has a policy-bearing definition:

```ts
interface StepDefinition<C> {
  readonly step?: Step<C>;
  readonly skippable: boolean;
}
```

An override has three explicit meanings:

```ts
const stepOverrides = {
  getSystemPrompt: undefined, // use the registered default
  gatherContexts: customStep, // replace it
  selfReflection: SKIP_STEP, // deliberately skip it
};
```

The Step Registry is resolved when its Workflow is created, not separately by each run. Unknown
overrides, registered Steps without an implementation, attempts to skip a required Step, and a
skipped or missing entry Step fail during Workflow creation. A dynamic call outside the resolved
registry fails explicitly at run time.

An explicitly skipped Step remains represented in the resolved registry. Calling it through
`runStep` performs a deliberate no-op. This is different from an absent Step.

## Run lifecycle

One execution follows a deliberately small sequence:

```text
1. Agent receives input, an optional AbortSignal, and an optional explicit Workflow Plan.
2. Agent creates one Agent Context.
3. Agent resolves each named Workflow from the ordered plan.
4. Configuration-skipped Workflows are bypassed.
5. Active Workflow evaluates its internal condition.
6. Running Workflow creates one Workflow Context and invokes its entry Step.
7. Nested Steps share that Workflow Context and resolve through its Step Registry.
8. Workflow produces a result; Agent applies it to the shared Agent Context.
9. After the plan completes, Agent returns Agent Context output.
```

Each Workflow's Step Executor wraps every active Step invocation, including nested ones. It is the
seam for tracing, timing, permissions, and execution-wide mechanics within that Workflow.

The initial implemented runtime deliberately does not yet add retries, event middleware, transaction
management, cycle detection, background-job semantics, or a Condition Registry. Named replaceable
Conditions should be added as concrete Steps reveal them.

Workflow Runtime does provide `onSuccess`, `onError`, and guaranteed `onFinally` handlers after an
active Workflow Context has been created. `onError` receives the original execution or success-hook
failure. `onFinally` runs even when execution or `onError` fails. If lifecycle handlers also fail, an
`AggregateError` preserves the original failure and every handler failure in deterministic order.
Condition-skipped Workflows create no Workflow Context and invoke no lifecycle handler. These are
runtime mechanics rather than ordinary Steps; individual Steps remain responsible for local recovery
and local resource cleanup.

## Invocation vocabulary

- **Agent Run** (`agent.run()`): complete public lifecycle across an explicit Workflow Plan.
- **Workflow Run**: one named Workflow with one Workflow Context.
- **Request Workflow**: foreground `prepareRequest -> executeRequest` processing.
- **Agent Loop**: inner bounded model/tool loop used by `runAgentInteraction`, normally delegated to
  Pi. It is not the complete Agent lifecycle.
- **Actor interaction**: bounded Agent Loop invocation whose Engine may declare streamable normalized
  events.
- **Actor direct invocation**: one buffered bounded completion without a tool loop.

Agent Base exposes both modes through its owned Actor Engine contract. A Workflow selects an Actor by
Responsibility; not every LLM call is forced through an Agent Loop.

## Storage model

Storage is always a replaceable adapter or an explicitly injected resource. Agent Base must not
hard-code a database connection.

Pi SQLite is a suitable default for ordinary session and chat persistence. Its standard schema can
store Pi session entries and opaque custom metadata. It does not by itself provide arbitrary
product tables or transactions spanning session writes and product authorities.

Products with stronger requirements may provide a composite adapter. A composite SQLite implementation may deliberately share one connection to support product-owned
transactions; that remains an adapter decision, not an Agent Base assumption.

## Application integration

Applications provide configuration, adapters, and Workflows around the existing Agent.
They own any integration with Model Workbench.

## Design rules

- Keep Agent and Workflow definitions run-stateless.
- Keep mutable state in Agent Context or Workflow Context according to its lifetime.
- Make dependencies explicit in constructors, factories, and Contexts.
- Keep default composition readable from one source file.
- Execute only an explicit Workflow Plan; never iterate the entire registry implicitly.
- Treat leaf, composite, and Workflow entry execution as the same Step abstraction.
- Resolve all nested Steps through the current Workflow Context's registry.
- Distinguish configuration skip from Workflow applicability conditions.
- Support replacement at leaf, composite, adapter, and whole-workflow granularity.
- Permit skipping only through `SKIP_STEP` and only for explicitly skippable definitions.
- Fail explicitly for missing, unknown, or illegally skipped Steps.
- Put Pi behind adapters and reuse it aggressively.
- Keep utility packages passive.
- Keep exactly one composition root per assembled agent package.
- Let applications host an assembled agent; do not let them redefine it.
- Do not add abstraction until at least one concrete boundary needs it.

## Current implementation scope

The current foundation contains:

- `@ta-agent/base-identity`: stable identity value and runtime validation;
- `@ta-agent/base-config`: generic codecs, snapshots, CAS revisions, storage ports, and an in-memory
  reference adapter;
- `@ta-agent/base-model`: Provider Model and credential references, an invocation-time credential
  resolver port, normalized text messages and usage, bounded Agent Loop events, execution targets,
  runtime ports, and structured failures;
- `@ta-agent/base-session`: generic session/turn authority plus the process-local memory adapter;
- `@ta-agent/base-workflow`: reusable Agent and Workflow classes, explicit Workflow Plans,
  Agent-level Workflow Registry, configuration and condition skips, two run-scoped Context
  lifetimes, Step Registry, Step Executor, and registry-based composite composition.
- `@ta-agent/base-request`: the canonical
  `request Workflow -> runRequest -> prepareRequest/executeRequest` composition, stable Request Step
  names, fail-fast generic placeholders, concrete text-request Step overrides over injected ports, and
  the OutputSink lifecycle;
- `@ta-agent/base-pi`: the isolated low-level Pi `0.82.1` loop adapter with one shared Actor runtime,
  a deterministic faux profile, exact builtin provider/model binding, and explicit text-only
  OpenAI-compatible endpoints;
- `@ta-agent/base-agent`: the official assembled request composition with bounded execution,
  in-memory sessions, faux and ordinary Pi provider shortcuts, streaming, and supported
  adapter/Step/Workflow replacement.

The Workflow package accepts a product's already resolved typed config. It does not resolve or
persist configuration itself. The composition architecture is formal, but memory persistence remains
a development default for faux and ordinary provider shortcuts. OAuth, durable credential storage,
dynamic provider catalog persistence, broad provider qualification, automatic failover, identity
catalog lifecycle, and the standalone CLI remain bounded later work.
