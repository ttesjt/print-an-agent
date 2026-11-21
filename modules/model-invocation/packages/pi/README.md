# `@print-an-agent/model-invocation-pi`

Pi infrastructure adapter for independent Actor and model interaction contracts.

Licensed under MIT. Pi and TypeBox attribution and license texts are in
[Third-party notices](THIRD_PARTY_NOTICES.md).

This is the isolated adapter package that imports Pi and TypeBox. It uses Pi's low-level loop,
translates Core-owned schemas at the adapter boundary, forces sequential tool execution, and
delegates every tool proposal to the consumer's borrowed execution port. Agent Base may supply its
Tool Broker; plain programs may supply another implementation. The adapter does not own permissions,
registries, or disposal. Rejected tool ports retain the original consumer error and prevent later
tool-port calls in the same interaction; explicit `handler-error` outcomes remain model-visible and
allow recovery. Schema translation preserves each object's required and optional fields, including
nested objects. Pi and TypeBox types do not appear in public factories.

The deterministic faux profile supports offline multi-turn tool-loop tests. Text from intermediate
tool-use turns is suppressed; only ordered deltas from the terminal assistant turn are published.
The same profile supports direct completion without constructing an Agent or Session. It accepts
only Core-owned bounded values and
exports a Pi-backed Actor Engine with a closed capability declaration, maps Actor invocation config
to Pi options, and normalizes output and failure identities before returning. Its interaction
capability is declared streamable and traverses Pi's event-producing Agent Loop. `complete` remains
buffered; the separate `stream` capability delivers one generation without any ToolRuntime or loop.

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
resolved once per invocation through the Core credential port. Resolver-owned credential fields
are captured once, validated, and copied into a frozen snapshot before use. Pi ambient environment/file
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
buffered and single-generation streaming consume the same underlying Pi provider stream.
Provider deadlines inherit but never reverse-abort Actor/Request cancellation and retain distinct
`MODEL_PROVIDER_RESPONSE_START_TIMEOUT` or `MODEL_PROVIDER_STREAM_IDLE_TIMEOUT` identities.

The policy deliberately does not expose a purported connect-only timeout: Pi's common public
boundary cannot distinguish DNS, TCP, TLS, request upload, and server wait for every provider. It
also does not treat Pi's provider-specific `timeoutMs` behavior as one portable Agent Base contract.
Inspection exposes the normalized non-secret policy; credential readiness remains a credential-only
check and performs no network health probe.

The npm root remains the only package entry: three runtime exports and nineteen named type exports.
It composes the Provider and Faux public APIs. Internal feature entries are explicit and do not add
npm subpaths; Pi and TypeBox contracts remain private.

| Path                                  | Responsibility                                                               |
| ------------------------------------- | ---------------------------------------------------------------------------- |
| `src/index.ts`                        | Explicit package exports from Provider and Faux                              |
| `src/types.ts`                        | SDK-independent invocation-kind vocabulary                                   |
| `src/provider/profile.ts`             | Ordinary Profile composition and readiness                                   |
| `src/provider/configuration.ts`       | Closed configuration validation and normalization                            |
| `src/provider/model-binding.ts`       | Pi model registry, catalog lookup and explicit auth policy                   |
| `src/provider/inspection.ts`          | Whitelisted non-secret inspection projection                                 |
| `src/provider/types/`                 | Input/normalized configuration and public Profile contracts                  |
| `src/faux/profile.ts`                 | Deterministic response queue, call counter and observations                  |
| `src/faux/responses.ts`               | SDK response construction                                                    |
| `src/faux/snapshots.ts`               | Core-facing request/tool-result capture and defensive copies                 |
| `src/faux/types.ts`                   | Cohesive public Faux contracts                                               |
| `src/execution/runtime.ts`            | Runtime-owned target identity and credential admission                       |
| `src/execution/actor-engine.ts`       | Minimal Core Engine binding                                                  |
| `src/execution/credentials.ts`        | Per-invocation resolution and single validated credential snapshot           |
| `src/execution/failures.ts`           | Shared cancellation, timeout and provider-failure mapping                    |
| `src/execution/types.ts`              | Private SDK binding, hooks and Engine handler contracts                      |
| `src/execution/generation.ts`         | One collected or streamed generation, including producer cleanup             |
| `src/execution/transport-liveness.ts` | Response/idle timing and pause during downstream delivery                    |
| `src/execution/interaction/`          | Tool-capable runner, event delivery, tool execution and local state types    |
| `src/translation/`                    | Pure message, readable-delta, invocation-option and tool-schema translations |

Provider and Faux consume Execution's entry; Faux also consumes Translation's entry. Execution
consumes Translation and the neutral invocation-kind contract. Translation never depends on either
Profile or Execution. Interaction consumes its explicitly shared ancestor types, failure mapping
and transport boundary; shared execution modules do not depend back on Interaction.

The runtime keeps its target WeakMap and checks target identity and invocation budgets before
resolving credentials. Each model turn has a fresh transport boundary. Interaction and Generation
retain their separate error precedence and cleanup. Translation does not execute tools or retain
invocation state. Faux response factories and inspectors receive separate frozen snapshot copies;
reverse invocation-option mapping captures only supported controls, never API keys.

Independent types use their owner's `types.ts` or `types/<concept>.ts`; implementation-local
options stay beside their sole consumer. Public factories explicitly return Core-facing Profile
contracts, keeping SDK types out of the reachable public declaration graph.

Tests follow their owner under `test/unit/` and `test/integration/`; `test/support/` owns the local
HTTP fixture, and `test/types/` qualifies the compiled public API. Run
`pnpm test:model-invocation-qualification` from the repository root. Its Pi source check declares
feature entries, dependency directions and pure-type runtime erasure, and checks the baseline
public symbol inventory and public declarations. It inspects literal imports/re-exports, including
type-only edges; runtime ownership, failure priority and state lifecycles still require review.

OAuth, durable credential storage, dynamic model refresh, provider health management, automatic
retry/failover, and rich media remain deferred.
