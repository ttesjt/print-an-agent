# `@ta-agent/base-pi`

Pi infrastructure adapter for Agent Base-owned model and Agent Loop contracts.

This is the only Agent Base package that imports Pi or TypeBox. It uses Pi's low-level loop, translates
Agent Base-owned schemas at the adapter boundary, forces sequential tool execution, and delegates
every proposal to the run-scoped Agent Base Tool Broker. Pi and TypeBox types do not appear in the
public factories.

The deterministic faux profile supports offline multi-turn tool-loop tests. Text from intermediate
tool-use turns is suppressed; only ordered deltas from the terminal assistant turn are published.
The same profile implements Session compaction through Pi's direct completion boundary rather than
misrepresenting compaction as a full Agent Loop. It accepts only Agent Base-owned bounded values and
exports a Pi-backed Actor Engine with a closed capability declaration, maps Actor invocation config
to Pi options, and normalizes output and failure identities before returning. Its interaction
capability is declared streamable and traverses Pi's event-producing Agent Loop; direct completion
remains buffered.

Readable Pi `thinking_delta` events map to Model-owned `reasoning-delta` events immediately, across
all model turns. Empty deltas and explicitly redacted blocks are ignored; signatures and opaque
payloads are never forwarded. `thinking_end` does not republish accumulated content. Reasoning is
separate from final-turn-only text and does not change the persisted assistant message or future
Agent Base Session context. The adapter does not add reasoning-effort/generation configuration.
Both deterministic faux events and a localhost OpenAI-compatible SSE fixture exercise this path
through Pi's public boundary without credentials or an external model.

`createPiProviderRuntime()` supplies the ordinary profile over the same internal runtime. Its closed
configuration supports an exact model from Pi `0.82.1`'s builtin catalog or one explicit text-only
OpenAI-compatible endpoint with bounded context and output tokens. Builtin profiles require an
opaque credential reference; compatible endpoints may instead be explicitly keyless. API keys are
resolved once per invocation through the Agent Base credential port. Pi ambient environment/file
auth is disabled, and inspection/readiness never returns credential references or secret values.
Builtin reasoning capability comes from Pi's catalog. Every OpenAI-compatible profile must instead
declare `supportsReasoning` explicitly because arbitrary endpoints cannot be detected reliably; the
value is validated, mapped to Pi's `Model.reasoning`, and exposed through runtime inspection. It is
a truthful capability/request-construction declaration, not a request to generate reasoning and not
a guarantee that a provider response will contain readable reasoning. Such profiles must also
declare `compatibility.supportsDeveloperRole`. This independent flag controls whether reasoning
models encode instructions with OpenAI's `developer` role or the more broadly compatible `system`
role. Agent Base does not infer it from an OpenAI-compatible URL. Inspection exposes this closed,
non-secret compatibility decision. Builtin profiles continue to use Pi catalog compatibility and do
not accept or invent this declaration.

Ordinary provider runtime options may also supply a closed `transportLivenessPolicy`. Its
`responseStartTimeoutMilliseconds` bounds the wait from the start of a Pi provider invocation to the
response beginning or a first normalized provider event. Its `streamEventIdleTimeoutMilliseconds`
bounds the wait for the
first or next normalized Pi event after response start. Both default to `null`, so Agent Base adds no
provider deadline unless the TypeScript host opts in. The idle clock pauses while Agent Base delivers
an already-received event through downstream backpressure. Each model turn owns a fresh boundary;
direct completion consumes the same Pi stream internally without becoming a streaming public API.
Provider deadlines inherit but never reverse-abort Actor/Request cancellation and retain distinct
`MODEL_PROVIDER_RESPONSE_START_TIMEOUT` or `MODEL_PROVIDER_STREAM_IDLE_TIMEOUT` identities.

The policy deliberately does not expose a purported connect-only timeout: Pi's common public
boundary cannot distinguish DNS, TCP, TLS, request upload, and server wait for every provider. It
also does not treat Pi's provider-specific `timeoutMs` behavior as one portable Agent Base contract.
Inspection exposes the normalized non-secret policy; credential readiness remains a credential-only
check and performs no network health probe.

The implementation is organized by change reason: `runtime/` owns shared Pi translations and loop
execution, `provider/` owns ordinary validation/composition, and `faux/` owns deterministic fixtures
and inspection. OAuth, durable credential storage, dynamic model refresh, provider health
management, automatic retry/failover, and rich media remain deferred.
