# `@ta-agent/base-model`

Provider-independent model invocation and bounded Agent Loop contracts.

The package owns Provider Model References, normalized text messages, usage, execution targets,
provider-turn bounds, streaming and metadata-only tool lifecycle events, runtime ports, and
structured failures. Provider SDK, Pi, and TypeBox types are adapter details and never appear in this
public API.

The final message surface remains text-only. Tool proposal and execution authority live in
`@ta-agent/base-tool`; this package carries only the run-scoped runtime port and safe event metadata.
The normalized message union distinguishes user input, assistant output, and an untrusted `context`
projection so a Session compaction is never presented as original conversation or system policy.
Provider adapters choose the safest supported wire-role translation. Images and provider-specific
options remain deferred.
