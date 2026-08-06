# Agent Base

Our small, transparent, and hackable foundation for building agents.

Agent Base owns agent identity, configuration and resource boundaries, plus explicit Workflow plans
that compose replaceable Steps into a runnable agent. It delegates commodity execution
capabilities—provider calls, tool loops, streaming, and default session behavior—to Pi adapters
wherever Pi already solves the problem well.

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
- `@ta-agent/base-session`: generic session ports and the process-local memory adapter;
- `@ta-agent/base-workflow`: generic Agent, Workflow, Context, Step, and lifecycle runtime;
- `@ta-agent/base-request`: canonical foreground Request Workflow, OutputSink, and concrete request
  Steps over injected ports;
- `@ta-agent/base-pi`: the isolated Pi `0.82.1` adapter and deterministic offline provider profile;
- `@ta-agent/base-agent`: the official assembled composition root.

The current assembled profile is a real streaming request path through Pi with in-memory sessions and
a deterministic faux provider. Its composition and replacement boundaries are formal; durable
persistence, ordinary provider registration, and non-empty tool execution remain later capabilities.
