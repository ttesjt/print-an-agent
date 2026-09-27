# `@ta-agent/base-model`

Provider-independent model invocation and bounded Agent Loop contracts.

The package owns low-level Provider Model References, normalized text messages, usage, provider
execution targets, model-turn bounds, streaming and metadata-only tool lifecycle events, runtime
ports, and structured failures. These contracts support infrastructure adapters such as Pi. The
assembled Agent routes calls through `@ta-agent/base-actor`; it does not expose a raw model runtime as
its composition contract. Provider SDK, Pi, and TypeBox types remain adapter details.

A Provider Model Reference may carry an opaque credential reference, never an API key. Provider
adapters resolve it at invocation time through `ProviderCredentialResolver`; missing, malformed, and
failed resolutions use stable Agent Base errors. Resolver output is runtime-only and does not enter
messages, inspection, traces, Sessions, or replay state.

`ProviderTransportLivenessPolicy` is the provider-independent vocabulary for optional response-start
and normalized stream-event idle deadlines. Both fields use `number | null`, and the standard policy
sets both to `NO_PROVIDER_TRANSPORT_TIMEOUT`. The contract does not claim a portable DNS/TCP/TLS
connect phase or impose one provider implementation; an adapter owns enforcement and maps only the
deadline it creates to the corresponding stable model failure.

The final message surface remains text-only. Tool proposal and execution authority live in
`@ta-agent/base-tool`; this package carries only the run-scoped runtime port and safe event metadata.
The normalized message union distinguishes user input, assistant output, and an untrusted `context`
projection so a Session compaction is never presented as original conversation or system policy.
Provider adapters choose the safest supported wire-role translation. Images and provider-specific
options remain deferred.
