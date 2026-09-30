# `@ta-agent/base-composition`

Agent Base application composition contracts and the official Standard runtime assembly.

Production source is organized by feature boundary. The existing Standard single-Agent composition
lives under `src/runtime/`; the package-root `src/index.ts` is only the stable public re-export
boundary. Consumers continue to import `@ta-agent/base-composition` and must not deep-import feature
internals. Runtime implementation remains self-contained: it does not import through the package
root or depend on another composition feature's implementation.

The package also exposes a storage-neutral application management composition contract through
`defineManagedAgentComposition()`. Its immutable `ManagedAgentCompositionDefinition` groups Config
codec, namespace allocation, Identity/Config authority, runtime-port creation, and raw-Agent
materialization by responsibility. Definition creation is synchronous and zero-I/O: it validates
and shallow-freezes framework-owned wiring records without invoking or recursively freezing
caller-owned codecs, Ports, factories, or materializers.

Generic runtime materialization receives only `{ identity, config, ports }` and must return the
actual typed `Agent`. Its exact concrete Agent type is preserved, including product-owned typed
members in addition to resources and the Operation Catalog; facade-shaped substitutes are rejected.
Namespace handles never enter the materializer; the application-owned runtime Port factory is the
explicit projection boundary for paths, database tenants, remote handles, and other product
resources. This preserves custom Agent types without making generic management depend on the
Standard runtime feature.

An optional medium-independent Config Projection Port represents one-way publish/reconcile behavior
and distinguishes `not-configured`, `current`, and `stale` states. Its `publish()` boundary receives
an explicitly published namespace, as does `reconcile()`. Projection is therefore always a
recoverable secondary view of an Agent that has already crossed its authoritative publication
boundary. Optional out-of-band Session management is represented by the typed
`SessionManagementCapability`; core Definitions do not assume that an Agent uses the standard
Session domain. A Generic Agent may have no Session, use Session only inside its runtime, or expose a
product-owned conversation model. Only Definitions that install the standard
`SessionManagementPorts` contract can create `SessionManagementService`.

`createSessionManagementService()` exposes active/retired listing, inspection, Turn pagination,
retire/restore, and coordinated purge/recovery without creating an Agent runtime or reading Identity
status, Agent Config, Projection, or provider credentials. Its port factory is scoped to one
published namespace, may be synchronous or asynchronous, and runs independently for each method.
Purge and recovery require the explicit Session + Request Journal maintenance Port and cannot
silently degrade to Session-only success. A disabled Agent's published Session resources remain
manageable. Definitions without this optional capability are rejected by TypeScript rather than by
a runtime `undefined` branch.

`createAgentManagementService()` consumes one Definition and exposes the storage-neutral static
Agent lifecycle: create, inspect, deterministic list, typed Config update, unknown Config import,
disable, and reactivate. Creation follows staged namespace allocation, authoritative Identity/Config
initialization, atomic namespace publication, and optional Projection publication. A failure before
namespace publication aborts the staged namespace. A Projection failure after publication returns a
stable coordination error without rolling back the Agent; inspection and reconciliation provide the
recovery path. Likewise, an authoritative Config or Identity update is never rolled back because the
non-authoritative Projection later fails.

Management methods use branded `AgentId` values after creation and return immutable snapshots with
separate Identity, Config revision, and `not-configured | current | stale` Projection state. Config
mutation uses revision CAS, while `importConfig()` is the explicit `unknown` codec-ingestion boundary.
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
exactly one Agent owner with one Workflow Catalog and three public Operations: `foreground`,
`compactSession`, and `navigateSession`. The returned value is the actual `Agent`, not another
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
`agent` plus named `run()`, `compactSession()`, and `navigateSession()` methods. Correctness does not
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
- `compactSession()` for an explicit replaceable compaction Workflow;
- `navigateSession()` for inspect/select/fork/non-destructive rewind.

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
inject catalogs through `composeAgent()` define the same policy directly on each Actor. Standalone
durable JSON and managed manifests do not encode this host/runtime policy.

The ordinary provider shortcut also accepts
`provider.transportLivenessPolicy.responseStartTimeoutMilliseconds` and
`streamEventIdleTimeoutMilliseconds`. Both default to `null` and remain independent from Request and
Actor invocation deadlines. The official composition forwards the policy to its internal provider
adapter and exposes the normalized values through `inspectProvider()` without leaking Pi types.
Standalone durable JSON and managed manifests do not encode this TypeScript host/runtime policy.

Standalone configuration and concrete persistence selection belong to
`@ta-agent/base-standalone-agent`. Agent directories, Identity lifecycle, managed Config persistence,
automatic compaction scheduling, advanced branch lifecycle, provider failover, and product UX are
not composition responsibilities.
