# Workflow

Domain-independent, replaceable named Steps over a run-local context. The public packages are
`@print-an-agent/workflow-core` for execution and `@print-an-agent/workflow-bundle` for shared-resource assembly.
Neither knows about Agents, model providers, memory or persistence.
Steps and borrowed Resources are bound at assembly; each run supplies input and execution options
and owns independent state and cancellation. The definition projects each successful return value
from that run's state.

A Workflow is an implementation/execution unit, not an application Service. A Service may validate
and resolve a target, acquire capabilities on demand through its application's provisioning contract,
and invoke one or more Workflows. Resources are explicit and consumer-defined, including narrow
on-demand capability methods; Workflows/Steps do not know a Profile or its Resource Registry. Neither
Workflow nor a Service becomes the resource owner merely by using a capability.

Read [the usage guide](./docs/usage.md) and [the execution contract](./docs/execution-contract.md)
for API usage, execution semantics and resource ownership.
The [Bundle guide](./packages/bundle/README.md) covers typed collections with independent inputs
and results over one shared resource binding.
