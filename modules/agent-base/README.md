# Agent Base

Our small, transparent, and hackable foundation for building agents.

Agent Base owns agent identity, configuration and resource boundaries, plus explicit Workflow plans
that compose replaceable Steps into a runnable agent. It delegates commodity execution
mechanics—provider calls, low-level loop control, streaming, and default session behavior—to Pi
adapters wherever Pi already solves the problem well. Agent Base retains tool schema, permission,
budget, and execution authority behind provider-independent contracts.

LLM calls are modeled as `Responsibility -> Actor -> Engine`. Workflow and Step remain the sole
execution planner. An Actor is a named callable participant; an Engine supplies the replaceable
invocation implementation; a Responsibility selects an ordered compatible Actor candidate for a
registered reason such as foreground interaction or Session compaction.

The module is intentionally split between:

- utility and adapter packages, which are libraries and never services;
- one assembled agent package, which is the complete composition root;
- thin applications such as the CLI, which call the assembled agent instead of composing a second
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
- `@ta-agent/base-workflow`: generic Agent, Workflow, Context, Step, and lifecycle runtime;
- `@ta-agent/base-request`: canonical foreground Request Workflow, OutputSink, Request Journal, and
  concrete request Steps over injected ports;
- `@ta-agent/base-pi`: the isolated Pi `0.82.1` adapter with deterministic faux, builtin, and
  explicit OpenAI-compatible provider profiles;
- `@ta-agent/base-agent`: the official assembled composition root.

The assembled package offers a deterministic faux profile and a formal ordinary Pi provider
composition. Both run the same bounded request/tool and direct-completion paths. Memory remains
their zero-configuration development default, while callers can inject
the Agent Base SQLite adapter to retain committed conversation history across new Agent instances.
An independent SQLite Request Journal adapter provides opt-in restart-safe replay for explicit
idempotency keys; memory remains the zero-configuration journal default.
Registered tools are denied by default and execute only through the Agent Base Tool Broker when the
Responsibility, Actor, product, and runtime layers all allow them. The profile publishes only the final assistant turn and returns
privacy-safe tool-run metadata. Its composition and replacement boundaries are formal; generic
correlated observability is available through an explicit metadata-only sink. Trace retention is
disabled by default. Session compaction is an explicit bounded Agent Run: it retains authoritative
turns, persists a branch-scoped revisioned context projection, and supplies that projection plus the
raw recent tail to later requests. Session navigation is a separate explicit Agent Run supporting
inspect, select, fork, and non-destructive rewind over append-only lineage. Automatic compaction
scheduling, branch merge/delete/retention, durable trace/credential storage, OAuth, and broader
provider qualification remain deferred.
