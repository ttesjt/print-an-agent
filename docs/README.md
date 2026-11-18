# Print an Agent documentation

The [root README](../README.md) provides the shortest start. Coding agents read
[AGENTS.md](../AGENTS.md) for repository rules. Choose a task below, then consult the guide that owns
the contract you are changing.

## Choose a task

| Task                                      | Start here                                                                                                                      | Owning contract                                                                                                                                                                                                                    |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Install or try the reference app          | [Getting started](../README.md#getting-started) and [Agent Web demo](../README.md#try-agent-web)                                | [Local Agent Web host](../modules/agent-ui/apps/agent-web/docs/local-host.md)                                                                                                                                                      |
| Understand module boundaries              | [Architecture](architecture.md)                                                                                                 | The affected module and package READMEs                                                                                                                                                                                            |
| Add or change a package                   | [Workspace conventions](development.md#workspace-conventions) and [TypeScript package setup](development.md#typescript-package) | [Monorepo standards](standards/monorepo-standards.md) and the owning module                                                                                                                                                        |
| Write or review TypeScript                | [Code standards](standards/code-standards.md)                                                                                   | The affected package's public API and behavior                                                                                                                                                                                     |
| Define a Workflow or replace a Step       | [Workflow usage](../modules/workflow/docs/usage.md)                                                                             | [Execution contract](../modules/workflow/docs/execution-contract.md)                                                                                                                                                               |
| Call a model or implement an Engine       | [Model Invocation](../modules/model-invocation/README.md)                                                                       | [Invocation design](../modules/model-invocation/docs/design.md) and the [Pi adapter guide](../modules/model-invocation/packages/pi/README.md) when using Pi                                                                        |
| Compose an agent or supply adapters       | [Agent Base](../modules/agent-base/README.md)                                                                                   | [Composition](../modules/agent-base/packages/composition/README.md) and its [Resource Registry](../modules/agent-base/packages/composition/docs/resource-registry/README.md)                                                       |
| Change a request or Session               | [Agent Base design](../modules/agent-base/docs/design.md)                                                                       | [Request](../modules/agent-base/packages/request/README.md), [Sessionless workflows](../modules/agent-base/packages/request/docs/sessionless.md), or [Session lifecycle](../modules/agent-base/packages/session/docs/lifecycle.md) |
| Use Context or Retrieval Memory           | [Agent Memory](../modules/agent-memory/README.md)                                                                               | [Memory consumption](../modules/agent-memory/docs/consumption.md) and [Session Context Memory](../modules/agent-base/docs/session-context-memory.md) for Agent Base integration                                                    |
| Extend reusable UI or Agent Web           | [Agent UI](../modules/agent-ui/README.md)                                                                                       | [UI architecture](../modules/agent-ui/docs/architecture.md) and the [Agent Web guide](../modules/agent-ui/apps/agent-web/README.md)                                                                                                |
| Use Workbench or develop a Python backend | [Using Model Workbench](../modules/model-workbench/docs/using-model-workbench.md)                                               | [Python model backend template](../modules/model-workbench/templates/python-model-backend/README.md)                                                                                                                               |
| Verify a change                           | [Verification](development.md#verification)                                                                                     | The owning package's tests and the [root scripts](../package.json)                                                                                                                                                                 |
| Add or move documentation                 | [Documentation ownership](#documentation-ownership)                                                                             | This index and the guide that owns the contract                                                                                                                                                                                    |

## Engineering standards

The [npm package guide](releases.md) owns public package scope, artifact preparation, independent
consumer verification, licensing, and the separate publication review.

- [TypeScript code standards](standards/code-standards.md) cover code organization, contracts, effects,
  and review.
- [Monorepo standards](standards/monorepo-standards.md) cover package ownership, dependencies, builds,
  and pnpm workspace practices.
- [Development](development.md) records the actual commands, toolchain, and check coverage in this
  repository. [Architecture](architecture.md) owns module boundaries.

## Documentation ownership

The README explains the project and gets readers running. `AGENTS.md` provides coding instructions.
This index routes common tasks to the relevant guide. Module and package READMEs own local usage and
contracts. As a module grows, its README can route readers to its more detailed guides.

Put each rule or contract in one owning guide. Link to it from new entry points and document current
behavior and limits alongside examples. Verify commands against the current manifest or CLI and use
relative links for repository files. Keep temporary plans, progress, and review evidence in
engineering records outside the repository.
