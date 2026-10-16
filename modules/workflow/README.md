# Workflow

Domain-independent, replaceable named Steps over a run-local context. The public packages are
`@ta-agent/workflow-core` for execution and `@ta-agent/workflow-bundle` for shared-resource assembly.
Neither knows about Agents, model providers, memory or persistence.
Steps and borrowed Resources are bound at assembly; each run supplies input and execution options
and owns independent state, result and cancellation.

Read [the usage guide](./docs/usage.md) and [the execution contract](./docs/execution-contract.md)
for API usage, execution semantics and resource ownership.
The [Bundle guide](./packages/bundle/README.md) covers typed collections with independent inputs
and results over one shared resource binding.
