# `@ta-agent/base-composition`

Agent Base application composition contracts and the official Standard runtime assembly.

Production source is organized by feature boundary. The existing Standard single-Agent composition
lives under `src/runtime/`; the package-root `src/index.ts` is only the stable public re-export
boundary. Consumers continue to import `@ta-agent/base-composition` and must not deep-import feature
internals. Runtime implementation remains self-contained: it does not import through the package
root or depend on another composition feature's implementation.

`src/runtime/`, `src/management/` and `src/sessionless/` are isolated peer features. Runtime owns the official Standard
Agent assembly. Management owns only storage-neutral application contracts and coordination over
injected ports. Neither feature imports the other, management does not import local adapters or
concrete storage, and the package as a whole does not depend on the Standalone profile. Repository
architecture tests enforce these rules for static, exported, type-only, and dynamic imports.

## Sessionless requests

`createSessionlessRequestService()` resolves caller-owned resources and returns an actual Request
Workflow. It does not create an Agent, Session, Journal, execution facade or resource registry.
The profile (`direct`, `stream` or `interaction`) is chosen at composition time; each retains its
own typed resources, Step overrides and result contract. The resolver need not use an Agent ID.

```ts
const service = createSessionlessRequestService<string>({
  workflow: { mode: 'stream', name: 'website.response' },
  resolveResources: async ({ target, signal }) => {
    signal.throwIfAborted();
    return resolveWebsiteResources(target, signal);
  },
});
const workflow = await service.open('website', { signal });
const response = await workflow.run({ input: { message: 'Show me projects' }, signal });
```

`resolveWebsiteResources` is host-owned and returns the stream profile's typed resources, including
a streaming-capable Actor and a per-Run OutputSink factory. The host retains ownership of borrowed
Actors/Engines and credentials. Construction performs no I/O; `open()` resolves resources without
invoking the model. Cancellation is checked before and after resolution, then the caller passes the
same effective signal to `run()`. A host needing one deadline across resolution and execution wraps
both in its execution boundary. No resource cache, retry or fallback is implied.

Callers supply any prior context explicitly and decide how to store successful results. Generation
does not require a ToolRuntime; `interaction` instead requires its explicit tools and bounded loop
policy. Output close and Workflow success are distinct: consumers must await actual Run settlement
before publishing successful application history.

## Managed Agent composition

The package also exposes a storage-neutral application management composition contract through
`defineManagedAgentComposition()`. Its immutable `ManagedAgentCompositionDefinition` groups Config
codec, namespace allocation, Identity/Config authority, runtime-port creation, and raw-Agent
materialization by responsibility. Definition creation is synchronous and zero-I/O: it validates
and shallow-freezes framework-owned wiring records without invoking or recursively freezing
caller-owned codecs, Ports, factories, or materializers.

This application-level Definition is distinct from both the single-Agent `AgentDefinition` consumed
by `createAgent()` and the durable, JSON-like `AgentConfig` decoded by its Config codec. `Definition`
is a general code-contract suffix; the full name determines scope. Domain Services are narrow
capability objects created from the shared Definition, Ports declare external capability boundaries,
and injected Adapters implement those Ports.

Generic runtime materialization receives only `{ identity, config, ports }` and must return the
actual typed `Agent`. Its exact concrete Agent type is preserved, including product-owned typed
members in addition to resources and the Operation Catalog; facade-shaped substitutes are rejected.
Namespace handles never enter the materializer; the application-owned runtime Port factory is the
explicit projection boundary for paths, database tenants, remote handles, and other product
resources. This preserves custom Agent types without making generic management depend on the
Standard runtime feature.

The runtime Port factory receives `ManagedAgentRuntimeProvisioningInput<TConfig, TNamespaceHandle>`:
`{ namespace, identity, config }`, where Identity and Config are validated authoritative snapshots
including their revisions. `open()` acquires authority ports and reads authority before requesting
runtime ports. Provisioning and materialization use the same read result: the materializer receives
`identity.identity` and `config.value` from those snapshots, without a second authority read. This
does not promise an atomic snapshot across the two authorities. The provisioning input record is
shallow-frozen; the framework does not acquire or recursively freeze profile-owned resource handles.

Profile code still chooses adapter implementations and resource lifetime. A factory may use typed
Config data and revisions for an explicit resource-generation policy, or ignore them entirely;
Config does not select arbitrary code, and its revision does not automatically become the identity
of persistent resources. Pure runtime assembly remains the materializer's responsibility. Other
factories keep their narrower inputs: Session management needs a namespace, not Config or runtime
resources. Services acquire required capabilities at the point of use rather than through a global
upfront resource initialization phase.

An optional medium-independent Config Projection Port represents one-way publish/reconcile behavior
and distinguishes `not-configured`, `current`, and `stale` states. Its `publish()` boundary receives
an explicitly published namespace, as does `reconcile()`. Projection is therefore always a
recoverable secondary view of an Agent that has already crossed its authoritative publication
boundary. Optional out-of-band features are closed, independent typed capabilities rather than a
dynamic registry. The Definition builder infers capability presence from actual own fields, rejects
an explicitly `undefined` capability, validates each known wiring record, and shallow-freezes only
the records it creates. Its type projection preserves required, optional, and absent capability
fields through generic factory forwarding without re-evaluating the Core Definition constraints. It
does not recursively freeze injected factories or adapters. Capability interfaces compose by
intersection; adding one does not imply another or require overloads for every combination.

Out-of-band Session management is represented by `SessionManagementCapability`; the independent
`SessionNavigationCapability` owns the corresponding navigation-port boundary without making it
part of Session management. Core Definitions do not assume that an Agent uses the standard Session
domain. A Generic Agent may have no Session, use Session only inside its runtime, or expose a
product-owned conversation model. Only Definitions that install the relevant standard Ports can
create `SessionManagementService` or `SessionNavigationService`. Projection remains an optional
concern internal to Agent management coordination, not a capability-gated Service.

`createSessionManagementService()` exposes active/retired listing, inspection, Turn pagination,
retire/restore, and coordinated purge/recovery without creating an Agent runtime or reading Identity
status, Agent Config, Projection, or provider credentials. Its port factory is scoped to one
published namespace, may be synchronous or asynchronous, and runs independently for each method.
Purge and recovery require the explicit Session + Request Journal maintenance Port and cannot
silently degrade to Session-only success. A disabled Agent's published Session resources remain
manageable. Definitions without this optional capability are rejected by TypeScript rather than by
a runtime `undefined` branch. Session management methods accept `ManagementOperationOptions` and
check cancellation after namespace and Port preparation, immediately before the final Port call.
Once a lifecycle or maintenance mutation starts, the Service waits for the actual adapter outcome;
it neither races storage work nor claims ownership of adapter-internal execution fences.

`createSessionNavigationService()` exposes inspect/select/fork/non-destructive rewind directly over
one published Agent namespace. Each call resolves the namespace and creates fresh scoped navigation
Ports; it never materializes an Agent, reads provider credentials, or checks whether the Agent is
enabled for future runtime admission. The Service delegates complete validation, execution
admission, CAS mutation, and cleanup to the Session domain coordinator. Per-call cancellation can
prevent work before the mutation boundary but does not pretend to interrupt adapter I/O after a
commit begins. Retired Sessions remain inspectable while mutation admission retains the Session
domain's `SESSION_RETIRED` failure. Session management and navigation are independent capabilities;
installing either one never implies the other.

`createAgentManagementService()` consumes one Definition and exposes the storage-neutral static
Agent lifecycle: create, inspect, deterministic list, typed Config update, unknown Config import,
disable, and reactivate. Creation follows staged namespace allocation, authoritative Identity/Config
initialization, atomic namespace publication, and optional Projection publication. A failure before
namespace publication aborts the staged namespace. Once authority is committed, mutation methods
return a `ManagedAgentCommitResult`: its exact authority result is separated from the recoverable
Projection outcome. A Projection failure is reported as `projection.kind === 'failed'` with a stable,
safe code; it never rolls back authority or disguises the commit as an exception. Inspection and
reconciliation provide the recovery path.

Management methods use branded `AgentId` values after creation. Reads return immutable snapshots
with separate Identity, Config revision, and `not-configured | current | stale` Projection state.
Mutations return immutable committed authority plus a
`not-configured | current | stale | failed` Projection outcome. Config mutation uses revision CAS,
while `importConfig()` is the explicit `unknown` codec-ingestion boundary.

Consumers that coordinate product work after an authority commit must preserve each secondary
outcome independently. In particular, a runtime-reconciliation failure must not prevent the caller
from observing and reporting the Projection outcome that is already present in the commit result:

```ts
const commit = await agents.updateConfig(request, { signal });
const projectionOutcome = commit.projection;

let runtimeOutcome:
  | { readonly kind: 'succeeded' }
  | { readonly kind: 'failed'; readonly error: unknown };

try {
  await reconcileRuntime(commit.authority);
  runtimeOutcome = { kind: 'succeeded' };
} catch (error) {
  runtimeOutcome = { kind: 'failed', error };
}

reportCoordination({
  authority: commit.authority,
  projection: projectionOutcome,
  runtime: runtimeOutcome,
});
```

The example expresses consumer-owned coordination rather than an Agent Base runtime contract. A
consumer may use a different settled-result representation, but must not let either recoverable
secondary failure hide the other or reinterpret the authoritative commit as rolled back.

Every management call accepts optional `ManagementOperationOptions` with an `AbortSignal`.
Cancellation is checked at entry and after asynchronous preparation, immediately before a stateful
adapter boundary. Once an authority mutation starts, the Service waits for its real outcome and does
not relabel a successful commit as cancellation. Ports without a cooperative cancellation contract
are never raced in the background.
Namespace adapters report an atomic duplicate reservation through the stable
`MANAGED_AGENT_NAMESPACE_ALREADY_EXISTS` contract; the Service exposes it as
`MANAGED_AGENT_ALREADY_EXISTS` without relying on a racy resolve-before-stage precheck.
The Service never creates runtime ports or materializes an Agent. Raw adapter failures are converted
to safe management errors; stable Identity, Config validation, and CAS error identities remain
recognizable without exposing their underlying causes.

`createAgentRuntimeService()` is the separate generic boundary that opens a published managed Agent.
Each `open(agentId)` resolves current Identity and Config authority, rejects disabled Agents, creates
only that Agent's runtime ports, and returns the exact raw `Agent` produced by the injected
materializer. Runtime port factories may be synchronous or asynchronous. The Service does not
reconcile Projection, assume Standard Operation names, create an API facade, cache Agent instances,
or hot-update Agents that a caller already owns. Every successful `open()` is an independent
materialization; callers such as servers may retain and reuse the returned Agent under their own
lifecycle policy.

`composeAgent()` accepts Agent Base-owned Actor and Responsibility catalogs plus replaceable Session,
Request Journal, Tool, OutputSink, Workflow/Step, and observability ports. It constructs and returns
exactly one Agent owner with one Workflow Catalog and two public Operations: `foreground` and
`compactSession`. Session navigation is an independent, optional management capability and does not
require runtime materialization. The returned value is the actual `Agent`, not another
runtime facade, and requires a resolvable `main` Actor.

Products that need the same standard behavior plus product-owned resources and Operations use
`composeAgentWithExtensions()`. Its extension factory receives the exact immutable standard
definition, including standard Operation references, before the one Agent is constructed. The
factory may add typed resources and Operations but cannot replace a standard name. Name conflicts
fail before Agent construction, and the resulting Agent retains the ordinary immutable catalog and
deny-by-default cross-Operation rules. `createStandardAgentDefinition()` exposes the same frozen
definition for inspection and advanced definition-level composition; the guarded extension factory
is the preferred product integration boundary.

`createAgentAPI(agent)` is an optional transparent convenience projection. It exposes the wrapped
`agent` plus named `run()` and `compactSession()` methods. Correctness does not
depend on this layer: timeout mapping, input preparation, Session authority, and every other official
Operation behavior execute through raw `agent.invoke()`.

`createProviderAgentAPI()` is the ordinary-provider convenience factory. It accepts the closed
builtin or OpenAI-compatible provider profile, creates the required `main` Actor and built-in
Responsibilities, and retains the same replacement boundaries. Its `inspectProvider()` and
`checkProviderReadiness()` surfaces are metadata-only. Pi `0.82.1` remains the pinned internal
adapter; its name and types do not enter this package's public declarations.
OpenAI-compatible provider config requires an explicit `supportsReasoning` capability declaration;
builtin provider capability remains catalog-owned. It also requires the independent closed
`compatibility.supportsDeveloperRole` declaration so a reasoning-capable endpoint can retain
`system` instructions when it does not implement OpenAI's `developer` role. Inspection exposes both
non-secret declarations for OpenAI-compatible profiles and does not fabricate compatibility
metadata for builtin profiles.

`createDeterministicAgentAPI()` selects the reproducible offline development/test profile through
the same internal low-level loop boundary. It exposes `inspectDeterministicProvider()` for bounded
fixture evidence. Consumers needing multiple or custom Engines inject Agent Base-owned Actor and
Engine catalogs through `composeAgent()` directly and receive the raw Agent.

The runtime exposes:

- `run()` for the canonical Request Workflow and bounded provider/Tool loop;
- `compactSession()` for an explicit replaceable compaction Workflow.

`createSessionNavigationService()` provides inspect/select/fork/non-destructive rewind for
Definitions that explicitly install `SessionNavigationCapability`. It resolves scoped Session ports
without opening an Agent runtime or reading provider credentials.

The optional Agent API also exposes immutable `operationNames` and `workflowNames` inspection views.
Each method call delegates directly to the wrapped Agent and creates a distinct Agent Run with its
Operation-specific input, output, Context, local resources, and trace lifecycle.

Memory Session, Request Journal, OutputSink, and no-op tracing remain zero-configuration development
defaults. Callers may inject SQLite or product-owned adapters without changing the composition root.
Completed replay returns the original response without another provider call, Tool call, or Session
turn. Tool access remains deny-by-omission across Responsibility, Actor, product, and runtime policy.

The foreground Operation carries the validated `RequestPolicy` as its existing Operation config and
uses the generic Run Executor boundary to apply `timeoutMilliseconds`. The standard policy defaults
to `NO_REQUEST_TIMEOUT`; callers may select a positive cooperative Request Workflow execution
deadline or rely on explicit cancellation. The Request boundary maps only the deadline it creates;
narrower child deadlines retain their own error identity. Agent Operation itself has no
timeout-specific declaration, and the Agent runtime does not inspect arbitrary config fields.

The TypeScript Actor shortcuts on `createProviderAgentAPI()` and `createDeterministicAgentAPI()`
also accept `mainActor.invocationPolicy`. Its deadline is independent from Request policy, applies
only around the selected Actor's LLM invocation, and defaults to no automatic timeout. Products that
inject catalogs through `composeAgent()` define the same policy directly on each Actor. Composition
itself does not persist this policy. A concrete application profile may do so: the official
Standalone Config stores Actor invocation policy as authoritative Agent configuration and projects
it into this runtime contract when materializing the Agent.

The ordinary provider shortcut also accepts
`provider.transportLivenessPolicy.responseStartTimeoutMilliseconds` and
`streamEventIdleTimeoutMilliseconds`. Both default to `null` and remain independent from Request and
Actor invocation deadlines. The official composition forwards the policy to its internal provider
adapter and exposes the normalized values through `inspectProvider()` without leaking Pi types.
Composition does not own durable provider configuration. The Standalone profile deliberately stores
this liveness policy in its authoritative Config and supplies it during runtime materialization.
`createProviderRuntime({ config, textTokenCounter })` optionally binds a borrowed Core text counter to
the Engine. Inspection includes its frozen non-secret descriptor. This does not change model
generation, install a tokenizer or guess an encoding; callers select an implementation explicitly.

Explicit Session compaction accepts `sessionCompactionPolicy`,
`sessionCompactionTokenCounter: TokenCounter<TextTokenInput>`, per-Step overrides and a full Workflow
replacement. Without an explicit override, `resolveCompactionTokenCounter` uses the foreground
Responsibility's selected Actor's `textTokenCounter`, not the compaction Actor's counter. No tokenizer
is guessed from a Provider model. Without a matching bound counter, ordinary interaction still works
but eligible compaction fails explicitly. Estimates cannot satisfy its token target.
A call may select a stricter token
target through `compactSession({ sessionId, target: { maxTokens: 3000 } })` or the calculated
`{ limitTokens, ratio, reserveTokens }` form. Candidate loops remain bounded and publish only a
successfully completed, measured context. The compaction Operation owns its one overall optional
deadline; it is not renewed for each model call. See the Session package for Step and failure contracts.

Generic Identity lifecycle and Config-authority coordination belong to `composition/management`.
Concrete adapter selection, filesystem layout, SQLite schemas and table naming, Standalone Config
fields, and credential binding belong to `@ta-agent/base-standalone-agent` or another injected
profile. Automatic compaction scheduling, advanced branch lifecycle, provider failover, and product
UX also remain outside Composition.
