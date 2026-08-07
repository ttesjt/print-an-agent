# Agent Base

Our small, transparent, and hackable foundation for building agents.

Agent Base owns agent identity, configuration and resource boundaries, plus explicit Workflow plans
that compose replaceable Steps into a runnable agent. It delegates commodity execution
mechanics—provider calls, low-level loop control, streaming, and default session behavior—to Pi
adapters wherever Pi already solves the problem well. Agent Base retains tool schema, permission,
budget, and execution authority behind provider-independent contracts.

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
- `@ta-agent/base-model`: provider-independent model, message, streaming, and loop contracts;
- `@ta-agent/base-session`: generic session ports, the process-local memory adapter, and an opt-in
  versioned SQLite durable adapter;
- `@ta-agent/base-tool`: provider-independent schemas, registries, permission policy, and bounded
  run-scoped Tool Broker;
- `@ta-agent/base-workflow`: generic Agent, Workflow, Context, Step, and lifecycle runtime;
- `@ta-agent/base-request`: canonical foreground Request Workflow, OutputSink, Request Journal, and
  concrete request Steps over injected ports;
- `@ta-agent/base-pi`: the isolated Pi `0.82.1` adapter and deterministic offline provider profile;
- `@ta-agent/base-agent`: the official assembled composition root.

The current assembled profile is a real bounded request/tool path through Pi with a deterministic
faux provider. Memory remains its zero-configuration development default, while callers can inject
the Agent Base SQLite adapter to retain committed conversation history across new Agent instances.
An independent SQLite Request Journal adapter provides opt-in restart-safe replay for explicit
idempotency keys; memory remains the zero-configuration journal default.
Registered tools are denied by default and execute only through the Agent Base Tool Broker when every
permission layer allows them. The profile publishes only the final assistant turn and returns
privacy-safe tool-run metadata. Its composition and replacement boundaries are formal; generic
observability, session navigation/compaction, and ordinary provider registration remain deferred.
