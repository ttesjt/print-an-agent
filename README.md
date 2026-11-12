# Print an Agent

A TypeScript framework for building AI agents from interchangeable parts.

Use the libraries on their own or compose them into an application. The CLI, Agent Web, and
component gallery are reference applications. Consumers own application policy and integration.

- [Agent Base](./modules/agent-base/README.md): Agent identity, request execution, Session
  persistence, composition, and standalone profiles.
- [Workflow](./modules/workflow/README.md): typed workflows, replaceable steps, and bundles.
- [Model Invocation](./modules/model-invocation/README.md): Actor and Engine contracts, Pi-backed
  providers, embedding adapters, and token measurement.
- [Agent Memory](./modules/agent-memory/README.md): independent Context and Retrieval Memory
  capabilities and SQLite adapters.
- [Agent UI](./modules/agent-ui/README.md): reusable UI packages, a component gallery, and a
  reference Agent Web application.
- [Model Workbench](./modules/model-workbench/README.md): independent tooling for model operations,
  artifacts, and model invocation. It is not required to use Agent Base.

Agent Base's [Composition Resource Registry](./modules/agent-base/packages/composition/docs/resource-registry/README.md)
is optional infrastructure for typed resource recipes, scope-local sharing and cleanup. It is not
required by generic Services or Workflows.

The same request workflow can use the reference SQLite session adapter or a host-supplied adapter
through the Session port. See the [Agent Base execution diagram](./docs/architecture.md#agent-base-execution)
for how Composition supplies those resources and how a request reaches the model.

## Install and verify

From the root of the `print-an-agent` checkout, use Node.js `24.15.0` and pnpm `10.28.0`. Workspace
packages are linked from this checkout, so no other repository or private package registry is
required.

```sh
pnpm install --frozen-lockfile
pnpm test:architecture
```

The architecture check also builds the TypeScript workspace. It does not require a Python
environment. See [Development](./docs/development.md) for full validation with the Workbench Python
workspace.

To try the local reference Web application:

```sh
pnpm --filter @ta-agent/ui-agent-web build
pnpm --filter @ta-agent/ui-agent-web serve --port 4174
```

Open `http://127.0.0.1:4174`. See the [Agent Web README](./modules/agent-ui/apps/agent-web/README.md)
for local configuration and [Architecture](./docs/architecture.md) for package boundaries.
