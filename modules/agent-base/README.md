# Agent Base

Our small, transparent, and hackable foundation for building agents.

Agent Base owns agent identity, configuration and resource boundaries, plus typed Agent Operations
whose explicit Workflow plans compose replaceable Steps into a runnable agent. One Agent owns its
identity, global resources, Workflow Catalog, and Operation Catalog; each Operation invocation
creates an isolated Agent Run. It delegates commodity execution
mechanics—provider calls, low-level loop control, streaming, and default session behavior—to Pi
adapters wherever Pi already solves the problem well. Agent Base retains tool schema, permission,
budget, and execution authority behind provider-independent contracts.

LLM calls are modeled as `Responsibility -> Actor -> Engine`. Workflow and Step remain the sole
execution planner. An Actor is a named callable participant; an Engine supplies the replaceable
invocation implementation; a Responsibility selects an ordered compatible Actor candidate for a
registered reason such as foreground interaction or Session compaction.

Resolved Actors enforce their Engine boundary: every event is normalized against the closed Agent
Loop event contract, every interaction must emit one valid terminal assistant message, and the Engine
must return the same normalized message. A terminal message may be followed only by the expected
closing lifecycle events, so a custom Engine cannot commit one Session response while returning
another or continue producing content after completion. Direct results are normalized through the
same stable protocol-failure boundary. The Actor boundary also enforces the model-turn budget for
every Engine from normalized lifecycle events; provider adapters may stop earlier when they can avoid
starting an over-budget model invocation.

The module is intentionally split between:

- domain/utility packages, which own contracts and behavior without selecting local persistence;
- `@ta-agent/base-local-adapters`, which owns the official reusable in-process and SQLite
  implementations of those ports;
- `@ta-agent/base-composition`, which owns the official Standard raw-Agent runtime composition plus
  storage-neutral application management definitions and Services, and may project an `AgentAPI`
  convenience layer;
- `@ta-agent/base-standalone-agent`, which binds those generic contracts to the current concrete
  reference-application bootstrap, directory, and shared-SQLite profiles;
- thin applications such as the CLI, which call the Standalone Services or raw Agent instead of
  composing another runtime or lifecycle owner.

This module must not import Model Workbench or application runtimes. It does not own model
training or application-specific policy.

Read [the Agent Base design](./docs/design.md) before adding packages.

Current foundation packages:

- `@ta-agent/base-identity`: stable Agent identity values and lifecycle catalog contracts;
- `@ta-agent/base-config`: storage-agnostic typed configuration lifecycle and adapter contracts;
- `@ta-agent/base-actor`: immutable Actor/Engine contracts, technical capabilities, catalogs, and
  Responsibility routing;
- `@ta-agent/base-model`: provider-independent model, message, bounded execution-provenance,
  streaming, and loop contracts;
- `@ta-agent/base-observability`: privacy-safe correlated trace contracts and no-op sink;
- `@ta-agent/base-session`: generic Session, append-only navigation, and branch-scoped compaction
  ports plus replaceable Workflows/Steps;
- `@ta-agent/base-tool`: provider-independent schemas, registries, permission policy, and bounded
  run-scoped Tool Broker;
- `@ta-agent/base-workflow`: single-owner Agent, typed Operation/Run, Workflow Catalog, minimum
  Context, Step, and lifecycle runtime;
- `@ta-agent/base-request`: canonical foreground Request Workflow, OutputSink, Request Journal, and
  concrete request Steps over injected ports;
- `@ta-agent/base-local-adapters`: official Memory, SQLite, local OutputSink, and bounded trace
  implementations for generic Agent Base ports;
- `@ta-agent/base-pi`: the isolated Pi `0.82.1` adapter with deterministic faux, builtin, and
  explicit OpenAI-compatible provider profiles;
- `@ta-agent/base-composition`: the official Standard raw-Agent composition root, optional API
  template, and storage-neutral Agent management/runtime/Session Service contracts;
- `@ta-agent/base-standalone-agent`: the current standalone reference Agent bootstrap and concrete
  managed-profile boundary;
- `@ta-agent/base-cli`: the thin `agent-base` executable over the standalone Agent.

The composition package offers a deterministic provider profile and a formal ordinary-provider
composition. Pi remains the pinned internal adapter rather than part of the high-level public API.
Both profiles run the same bounded request/tool and direct-completion paths. Memory remains their
zero-configuration development default, selected from `@ta-agent/base-local-adapters`, while callers
can inject that package's SQLite adapter to retain committed conversation history across new Agent
instances.
Completed assistant messages always carry one truthful execution-provenance envelope. Ordinary
provider Engines record provider/model identity; custom Engines can carry bounded, immutable opaque
JSON evidence without Agent Base knowing its domain. Session and replay preserve that value, while
generic traces expose only the safe outer provenance type and never copy opaque evidence.
An independent SQLite Request Journal adapter provides opt-in restart-safe replay for explicit
idempotency keys; memory remains the zero-configuration journal default.
Each shipped local SQLite adapter independently owns its table-name input, validation, and quoting. All use
neutral `agent_` defaults and accept construction-time prefix or exact-name overrides. Standalone
TypeScript profiles forward one host policy and reject cross-domain collisions, while Agent config,
managed manifests, and CLI JSON remain unaware of physical table names.
Registered tools are denied by default and execute only through the Agent Base Tool Broker when the
Responsibility, Actor, product, and runtime layers all allow them. The profile publishes only the final assistant turn and returns
privacy-safe tool-run metadata. Its composition and replacement boundaries are formal; generic
correlated observability is available through an explicit metadata-only sink. Trace retention is
disabled by default. Session compaction is an explicit bounded Agent Operation: each invocation
creates a Run that retains authoritative
turns, persists a branch-scoped revisioned context projection, and supplies that projection plus the
raw recent tail to later requests. Session navigation is a separate explicit Agent Operation supporting
inspect, select, fork, and non-destructive rewind over append-only lineage. Automatic compaction
scheduling, branch merge/delete/retention, durable trace/credential storage, OAuth, and broader
provider qualification remain deferred.

For managed use, `@ta-agent/base-composition` provides the storage-neutral Definition and narrow
Agent management, runtime-opening, and optional Session management Services.
`@ta-agent/base-standalone-agent` binds those contracts to concrete resource namespace publication,
independently typed domain adapters, and optional manifest projection. The default managed profile
uses one explicitly configured root, one directory, and one SQLite database per Agent; an
alternative profile uses one shared SQLite database for multiple AgentId-isolated Agents and no
manifest. Both support create/open/list, Config CAS update, disable/reactivate, and out-of-band
Session lifecycle management without hard-deleting Agents. In the filesystem profile, `agent.json`
is a portable secret-free projection over SQLite authority. The CLI creates and opens durable Agents
through either explicit `--root` or `--database-path` plus `--agent-id`; `--config` is limited to a
fresh process-local Memory Session and cannot continue an existing Session. It does not select an
implicit storage location, load executable adapters or Tools from configuration, persist
credentials, or import Model Workbench or application runtimes.

`tests/integration` is a private test-only workspace that compiles and executes Agent Base as an
external package consumer. It imports only package entry points and exercises the raw Agent,
optional API projection, custom Engine/Tool/Step seams, ordinary loopback provider, durable replay,
and opaque managed-resource composition. It is integration evidence, not another runtime or
application layer.
