# Model Invocation

Independent, named Actor invocation through replaceable Engines. Consumers can request Completion
or Interaction capabilities without creating an Agent, Session, tool registry, or Workflow.
Independent text Embedding and Token Measurement capabilities are also available without an Actor.

`@ta-agent/model-invocation-core` owns messages, usage, execution provenance, capability declarations,
Actor definitions and bindings, invocation deadlines, and validated Engine protocols. It has no
production dependencies. Interaction receives a borrowed minimal tool-execution port; permission
policy, execution budgets and resource disposal belong to its consumer.

An Actor exposes only the methods supported by its Engine and effective capability limits.
`requireCompletionCapability()`, `requireStreamingCapability()` and `requireInteractionCapability()` validate dynamic selection and
return a narrow, callable view of the same Actor. `createActor()` needs no catalog; an immutable
catalog is available when named lookup is useful.

```ts
const actor = requireCompletionCapability(
  createActor({
    id: 'memory-proposer',
    engine,
    instructions: 'Propose a useful memory update.',
  })
);
const result = await actor.complete({
  instructions: '',
  messages,
  maxOutputCharacters: 8_000,
  signal,
});
```

Instructions compose in Actor/caller order. Consumers may add their own instruction policy above
this boundary. Invocation timeout defaults to `null`, preserves parent cancellation, and remains
cooperative. Engines must honor signals; arbitrary executable code cannot be forcibly terminated.

Agent Base owns Responsibility routing, permissions, Request/Session integration and application
lifecycle. Product adapters own model-specific bridges. This module has no product knowledge.

`@ta-agent/model-invocation-pi` supplies the ordinary Pi-backed Engine and deterministic faux profile.
It supports Pi's builtin model catalog and explicit OpenAI-compatible endpoints. Provider credentials,
reasoning/developer-role declarations and transport liveness are explicit adapter configuration.
Applications can bind that Engine to an Actor directly; Agent Base consumes the same adapter.

Single-generation streaming is a separate optional `stream` capability. A stream-only Engine needs
neither `complete` nor `interact`. `stream()` accepts the same generation inputs plus an awaited
`emit` callback and explicit `maxReasoningCharacters`; it returns the same complete result shape.
The event union is `ModelGenerationEvent`: readable `reasoning-delta`, `text-delta`, and one validated
`assistant-complete`. There are no tool-execution or interaction lifecycle events.
Generation describes the logical invocation contract, not a guaranteed number of HTTP requests.

```ts
const streamActor = requireStreamingCapability(actor);
const result = await streamActor.stream({
  instructions: '',
  messages,
  signal,
  maxOutputCharacters: 8_000,
  maxReasoningCharacters: 16_000,
  emit: async (event) => {
    await output.write(event);
  },
});
```

The streaming boundary serializes accepted delivery, applies backpressure and character budgets,
rejects malformed/late events, and validates terminal/result consistency before terminal delivery.
If text deltas were emitted, they must reconstruct the final text. Empty deltas are ignored.
It drains in-flight delivery on both success and failure. Callbacks must cooperate with cancellation;
an already-running callback without cancellation support cannot be forcibly stopped. Interaction's
consumer-owned failure drainage contract is separate. Readable reasoning is delivery data and does
not become assistant text, persistence, or model history automatically.

Run `pnpm test:model-invocation-qualification` from the repository root to verify the independent
packages, local provider fixtures, public contracts and enforced dependency direction.

## Text embedding

Core provides `TextEmbeddingCapability` and `createTextEmbedder()` separately from generation.
Requests contain a document/query task, uniquely identified texts and an `AbortSignal`; successful
results contain a complete, ordered batch of immutable numeric vectors and the binding's stable
representation reference. The optional `@ta-agent/model-invocation-embedding-http` package provides
explicit OpenAI-compatible HTTP embedding, including keyless or credential-reference authentication.
It does not use the Pi generation interface or require generation capabilities.

See [Text embedding](docs/text-embedding.md) for the public contracts, model-version commitments,
limits, errors, cancellation, resource ownership and standalone examples.

## Token measurement

Engine definitions may bind a borrowed `textTokenCounter`. Actors inherit it unless an explicit
Actor `textTokenCounter` overrides it. `requireActorTextTokenCounter(actor)` requires that optional
capability; ordinary completion, streaming and interaction remain usable without any counter.
Measurement never calls the model and is not governed by the Actor's generation timeout. The caller
supplies its own cancellation signal. Host code owns initialization, sharing and disposal of custom
counters. `bindTextTokenCounter()` validates and freezes the standalone-text descriptor, preserves the
implementation receiver and validates each returned identity and result. Text, content and request
scopes are not interchangeable. Optional official local implementations live in
`@ta-agent/model-invocation-token-counters`; Core does not import them.
The Pi adapter accepts an optional runtime `textTokenCounter` and exposes its descriptor through
inspection without changing provider requests or discovering an encoding. High-level Standalone
configuration resolves explicit declarations; neither Pi nor Core owns a model-to-tokenizer registry.

Core also exposes independent `TokenCounter<TInput>` capabilities. A counter needs no Actor, Engine,
Agent, Session or Workflow. Exact counters and estimators use the same interface; each result records
`tokens`, `accuracy`, `measurementRef`, `inputProtocolRef` and `scope`. Exactness applies only to the
declared measurement implementation/configuration and input protocol, not automatically to provider
billing or a complete chat request. No concrete model tokenizer is selected or included in Core.

```ts
const counter = createTokenCounter({
  measurementRef: 'my-encoding:fixed-options',
  inputContract: TEXT_TOKEN_INPUT_CONTRACT,
  measure: async (input, signal) => ({
    tokens: await myEncoding.count(input.text, signal),
    accuracy: TOKEN_MEASUREMENT_ACCURACY.EXACT,
  }),
});
const measurement = await counter.measure({ kind: TOKEN_INPUT_KIND.TEXT, text }, signal);
requireTokenMeasurement(measurement, {
  measurementRef: counter.descriptor.measurementRef,
  scope: TOKEN_MEASUREMENT_SCOPE.TEXT,
  accuracy: TOKEN_MEASUREMENT_ACCURACY.EXACT,
});
```

`createTokenCounter()` freezes a detached binding descriptor, validates inputs and implementation
results, and attaches binding identity itself. The implementation returns only `{ tokens, accuracy }`;
it cannot override identity or scope. Counts must be non-negative safe integers. Requirement fields
are equality checks, not conversions, budgets, model routing, or publication authority.
`parseTokenMeasurement()` validates detached/stored results; it does not authenticate their origin or
prove that an implementation's exactness claim is true.

`TokenInputContract<TInput>` supplies a stable `ref`, one semantic `scope`, nonempty unique
`inputKinds`, and a synchronous `parse(unknown)` function. Core checks each original/parsed root's
own data `kind`; the parser owns the remaining schema and must produce a stable invocation view
without changing kind. References and kinds use 1–256 ASCII characters, beginning with an
alphanumeric character and otherwise allowing letters, digits, `.`, `_`, `:`, `/` and `-`.

The only built-in input protocol is `TEXT_TOKEN_INPUT_CONTRACT`: a closed `{ kind: 'text', text }`
record that preserves all text, including whitespace. Explicit custom protocols may describe media,
mixed content or whole requests using the same generic counter interface. The named scopes are
`TEXT`, `CONTENT` and `REQUEST`; a scope does not imply a built-in media schema or counting algorithm.
Unsupported input kinds and missing media information must fail, never be silently discarded.
Core performs no file/URL access and does not assume counts are additive across input fragments.

Input contracts and implementations are trusted borrowed code. Core validates envelopes and kind
consistency, not arbitrary custom payload semantics. It does not clone large media payloads, choose
codecs, load resources, serialize calls, cache results, retry failures or create timers. Shared
implementations must isolate concurrent invocation state; the host owns resource disposal after work
settles.

Every call requires an `AbortSignal`. Pre-aborted calls do not invoke the parser or implementation;
checks after parsing and implementation settlement preserve the parent's exact cancellation reason.
Cancellation remains cooperative and does not stop waiting for uncooperative in-flight work.
Unknown implementation failures become `TOKEN_MEASUREMENT_FAILED` with the original `cause`;
structured measurement errors are retained. Malformed bindings, inputs, results and requirements have
separate stable error codes, as do unsupported inputs and unsatisfied requirements. Factory validation
messages do not contain input content or backend diagnostics. Implementations remain responsible for
safe messages when deliberately throwing their own structured measurement errors.
