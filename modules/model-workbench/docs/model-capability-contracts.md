# Model Capability Contracts

Model Capability Runtimes are process-local TypeScript objects supplied by the host. A Python or
remote backend is normally exposed through a thin TypeScript bridge, but the model-operation
semantics below do not depend on that transport.

Every fixed request envelope includes the owning `profileId`; a Capability or Runtime Support call
never relies on a global persistence or Artifact namespace. All four capabilities currently use
the same dispatch protocol:

```text
completed -> terminal succeeded / failed / cancelled / lost
accepted  -> opaque executionReceipt
```

An accepted execution is later observed through the Runtime Binding's Execution Support. Its
terminal result has exactly the same capability-specific shape as a directly completed execution.
The receipt is backend-owned JSON; Workbench stores it without interpreting it.

## Initializer

```text
request  = profileId + runId + custom input
success  = one parameter Artifact digest + handoff receipt + optional custom data
authority produced by Workbench = Base
```

## Trainer

```text
request  = profileId + runId + exact materialized Model State + custom input
success  = Base or additive Modification
           + one parameter Artifact digest and handoff receipt
           + optional custom data
```

The materialized Model State contains one Base and an ordered Modification stack. Each member
retains its Workbench identity and receives a transient backend-consumable Artifact binding.

## Exporter

```text
request  = profileId + runId + exact materialized Model State + custom input
success  = non-empty set of uniquely named Artifact digest / handoff receipt pairs
           + optional custom data
authority produced by Workbench = Output
```

Artifact names are portable identifiers and the set is normalized by name. Workbench assigns the
Output and Artifact identities, verifies every reported Artifact through the bound Artifact Handoff
Support, and records the exact source Model State as lineage. The Exporter does not invoke or
publish the Output.

## Output Invoker

```text
request  = profileId + exact Output identity + named materialized Artifacts + custom input
result   = completed custom output value | stream of custom output chunks
```

The input and output value Contracts are both required because the invocation result is the
capability's primary value rather than metadata attached to a newly accepted model asset. Output
invocation is scoped to one call, records no Run by default, and defines no managed model Session.
The same output Contract validates a completed value or every streaming chunk.

Streaming cancellation is cooperative. Workbench passes the caller's `AbortSignal` to the Output
Invoker, but does not independently terminate an already returned stream. The Invoker owns any
backend resources behind that stream and must continue observing the signal until iteration ends.
Stopping iteration early closes the wrapped iterator so the Invoker can release those resources.

## Contract and Artifact responsibilities

Draft 2020-12 JSON Schema is the recommended source for custom input, result-data, and invocation
output Contracts. Workbench separately validates the fixed request, invocation-result, dispatch,
terminal, and Artifact-result envelopes.

Producing Capabilities report content digests and opaque handoff receipts. They do not assign
Workbench Artifact, Base, Modification, or Output IDs and do not write Workbench persistence.
Runtime Supports verify and materialize Artifact references and observe or cancel detached
executions. The Control Plane owns acceptance, identity, Run state, and lineage.
