# Print an Agent

A TypeScript framework for building AI agents from interchangeable parts.

[Getting started](#getting-started) · [Try Agent Web](#try-agent-web) ·
[Documentation](docs/README.md) · [For coding agents](AGENTS.md)

## About the project

Use the libraries on their own or compose them into an application. The CLI, Agent Web, and
component gallery are reference applications. Application policy and integration belong to the
consumer.

- [Agent Base](modules/agent-base/README.md) covers agent identity, request execution, Session
  persistence, composition, and standalone profiles.
- [Workflow](modules/workflow/README.md) provides typed workflows, replaceable steps, and bundles.
- [Model Invocation](modules/model-invocation/README.md) provides Actor and Engine contracts,
  Pi-backed providers, embedding adapters, and token measurement.
- [Agent Memory](modules/agent-memory/README.md) provides independent Context and Retrieval Memory
  capabilities and SQLite adapters.
- [Agent UI](modules/agent-ui/README.md) provides reusable UI packages, a component gallery, and a
  reference Agent Web application.
- [Model Workbench](modules/model-workbench/README.md) is a separate tool I built to experiment
  with agent model parameters and fine-tuning. It lives alongside the framework in this repository
  for now. Agent Base runs independently of it.

The same request workflow can use the reference SQLite session adapter or a host-supplied adapter
through the Session port. The [architecture guide](docs/architecture.md#agent-base-execution) shows
how Composition supplies those resources and how a request reaches the model.

### External dependencies

- [Pi](https://github.com/earendil-works/pi) provides model provider integrations, streaming,
  and agent loop primitives for the Model Invocation adapter.

## Getting started

### Prerequisites

- Node.js `24.15.0` or later within 24.x. See [the pinned version](.node-version).
- pnpm `10.28.0`, as declared in [package.json](package.json).

Python is needed for full Workbench validation. The TypeScript build and Agent Web demo use Node.js.

### Installation

From the root of the `print-an-agent` checkout, run:

```sh
pnpm install --frozen-lockfile
```

The `@print-an-agent/*` packages resolve to this workspace checkout.

## Usage

### Try Agent Web

```sh
pnpm --filter @print-an-agent/ui-agent-web build
pnpm --filter @print-an-agent/ui-agent-web serve --port 4174
```

Open [Agent Web in demo mode](http://127.0.0.1:4174/?mode=deterministic). Choose an example agent and
send a message. The browser fixture requires no model API key and saves no data to a local database.

To connect a real model and set up local storage, see the
[local host guide](modules/agent-ui/apps/agent-web/docs/local-host.md).

### Use the libraries

Start with [defining a Workflow](modules/workflow/docs/usage.md#defining-a-flow) or
[calling a model through an Actor](modules/model-invocation/README.md). For the full request
lifecycle and managed agent composition, see [Agent Base](modules/agent-base/README.md).

## Documentation

Use the [documentation index](docs/README.md) to find the guide for your task. Coding agents start
with [AGENTS.md](AGENTS.md) for repository rules and verification.

## Contributing

Contributions are welcome. Bug reports, documentation improvements, and small examples are great
places to start. The [development guide](docs/development.md) covers setup, package conventions, and
how to verify a change. For the code and workspace rules, see the
[engineering standards](docs/README.md#engineering-standards).

## License

Print an Agent is available under the [MIT License](LICENSE).
