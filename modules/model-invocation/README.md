# Model Invocation

Independent, named Actor invocation through replaceable Engines. Consumers can request Completion
or Interaction capabilities without creating an Agent, Session, tool registry, or Workflow.

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
