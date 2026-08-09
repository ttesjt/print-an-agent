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

The module is intentionally split between:

- utility and adapter packages, which are libraries and never services;
- `@ta-agent/base-composition`, which returns the canonical composed Agent and optionally projects an
  `AgentAPI` convenience layer;
- `@ta-agent/base-standalone-agent`, which selects the current concrete reference-application
  profile;
- thin applications such as the CLI, which call the standalone Agent instead of composing another
  runtime.

This module must not import Model Workbench or application runtimes. It does not own model
training or application-specific policy.

Read [the Agent Base design](./docs/design.md) before adding packages.

Current foundation packages:

- `@ta-agent/base-identity`: stable Agent identity values;
- `@ta-agent/base-config`: storage-agnostic typed configuration lifecycle;
- `@ta-agent/base-actor`: immutable Actor/Engine contracts, technical capabilities, catalogs, and
  Responsibility routing;
- `@ta-agent/base-model`: provider-independent model, message, streaming, and loop contracts;
- `@ta-agent/base-observability`: privacy-safe correlated trace contracts, no-op sink, and bounded
  Memory adapter;
- `@ta-agent/base-session`: generic Session, append-only navigation, and branch-scoped compaction
  ports, replaceable Workflows/Steps, the process-local memory adapter, and an opt-in versioned
  SQLite durable adapter;
- `@ta-agent/base-tool`: provider-independent schemas, registries, permission policy, and bounded
  run-scoped Tool Broker;
- `@ta-agent/base-workflow`: single-owner Agent, typed Operation/Run, Workflow Catalog, minimum
  Context, Step, and lifecycle runtime;
- `@ta-agent/base-request`: canonical foreground Request Workflow, OutputSink, Request Journal, and
  concrete request Steps over injected ports;
- `@ta-agent/base-pi`: the isolated Pi `0.82.1` adapter with deterministic faux, builtin, and
  explicit OpenAI-compatible provider profiles;
- `@ta-agent/base-composition`: the official raw Agent composition root and optional API template;
- `@ta-agent/base-standalone-agent`: the current standalone reference Agent boundary;
- `@ta-agent/base-cli`: the thin `agent-base` executable over the standalone Agent.

The composition package offers a deterministic provider profile and a formal ordinary-provider
composition. Pi remains the pinned internal adapter rather than part of the high-level public API.
Both profiles run the same bounded request/tool and direct-completion paths. Memory remains
their zero-configuration development default, while callers can inject
the Agent Base SQLite adapter to retain committed conversation history across new Agent instances.
An independent SQLite Request Journal adapter provides opt-in restart-safe replay for explicit
idempotency keys; memory remains the zero-configuration journal default.
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

For standalone use, `@ta-agent/base-standalone-agent` exposes a closed versioned JSON configuration
decoder and `createStandaloneAgent()`. The profile requires explicit memory or absolute-path SQLite
persistence and optionally maps one provider credential reference to a named environment variable;
secret material never belongs in config. The CLI exposes provider readiness, streamed requests,
compaction, and Session inspect/select/fork/rewind. It does not select implicit filesystem paths,
load Tools from configuration, or import Model Workbench or application runtimes.
