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

The implementation is organized by change reason: `runtime/` owns shared Pi translations and loop
execution, `provider/` owns ordinary validation/composition, and `faux/` owns deterministic fixtures
and inspection. OAuth, durable credential storage, dynamic model refresh, provider health
management, automatic retry/failover, and rich media remain deferred.
