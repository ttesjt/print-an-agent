# `@print-an-agent/model-invocation-core`

Independent Actor contracts and runtime objects for model invocation. No Agent, Session, provider
SDK, or network connection is required by Core itself.

An Engine declares the capabilities it implements: `complete` for buffered generation, `stream` for
incremental single generation, and `interact` for a tool loop. Actors bind an Engine to identity,
optional instructions, generation configuration, capability limits, and invocation policy. Missing
capabilities stay absent rather than becoming methods that always throw.

```ts
import {
  createActor,
  requireCompletionCapability,
  type ActorEngineInput,
} from '@print-an-agent/model-invocation-core';

export async function answer(engine: ActorEngineInput, message: string) {
  const actor = requireCompletionCapability(createActor({ id: 'website', engine }));
  const result = await actor.complete({
    instructions: 'Answer questions about this website.',
    messages: [{ role: 'user', text: message, timestamp: Date.now() }],
    maxOutputCharacters: 8192,
    signal: new AbortController().signal,
  });
  return result.message.text;
}
```

Use `@print-an-agent/model-invocation-pi` for a ready-made Pi Engine, or implement the Core-owned
Engine contract yourself. Core validates result provenance and event protocols, propagates
cancellation, and supports optional invocation deadlines and token measurement. It does not own
credentials, persistence, or tool authorization.

## Capability selection requirements

`validateActorCapabilityRequirements()` normalizes the Core-owned technical requirements used
by `satisfiesActorRequirements()`. A valid result contains a detached, frozen `value`; a rejected
result contains a closed `issue` value. The validator owns supported modes/media, interaction
streamability, required flags and minimum context tokens. It selects no Actor or application role.

Callers choose how to report those diagnostics. Agent Base maps them to Responsibility errors;
independent consumers can use the result directly. Exceptions raised during caller-value access or
collection normalization propagate. The small result types stay with their validator and derive
issue choices from its controlled runtime definitions.

This package is ESM and requires Node.js 24.15 or later within Node.js 24. See the repository's
[Model Invocation guide](https://github.com/ttesjt/print-an-agent/tree/main/modules/model-invocation)
for the complete contract. Licensed under MIT; see `LICENSE` in the package.

## Source ownership

The npm root remains the only supported package entry. It deliberately re-exports four internal
feature APIs; each nested feature also has an explicit entry.

| Scope                     | Responsibility                                                                                 |
| ------------------------- | ---------------------------------------------------------------------------------------------- |
| `actor/`                  | Definition and Engine normalization, callable binding, immutable Catalog and capability access |
| `actor/capabilities/`     | Capability vocabulary, declarations, limits, narrowing and selection requirements              |
| `actor/invocation/`       | Completion/Interaction/Streaming flows, deadlines, result checks and protocol state machines   |
| `model/messages/`         | Message roles, usage and immutable normalization                                               |
| `model/provenance/`       | Provenance envelopes and bounded JSON evidence copying/validation                              |
| `model/events/`           | Common generation events plus Interaction lifecycle and tool events                            |
| `model/provider/`         | Provider references, credential ports and transport liveness policy                            |
| `model/types/`            | Borrowed model-facing tools and the Interaction Runtime composition contract                   |
| `embedding/`              | Representation identity, text batches, vector results and invocation policy                    |
| `token-measurement/`      | Generic input protocols, counters, measurements and equality requirements                      |
| `token-measurement/text/` | Built-in standalone-text protocol and borrowed text-counter binding                            |
| `timer-limits.ts`         | The underlying timer range shared by the three timer-backed policies                           |

Independent contracts live in the owning `types.ts` or `types/`. Controlled options stay with their
derived unions. The built-in text input type is inferred from its normalizer. Small state-machine
contracts stay beside their implementation. Nominal identity types have one declaration owner.

Actor binding uses invocation APIs, Model protocols and Token Measurement. Invocation consumes only
its required binding facts, handler surface and capability declarations; it does not import Actor
assembly. Model messages use provenance, provenance uses Provider references, and events use messages.
The Model-level Interaction Runtime contracts compose those features without dependencies back from
them. Generic measurement and its types remain independent of Text specialization. Nested features
consume explicit ancestor contracts/capabilities rather than an ancestor aggregate.

Streaming owns serialized delivery, backpressure and drainage on success and failure. Interaction
consumers drain already-started delivery on Engine failure before disposing their resources. Tools,
counters and Engines remain borrowed; their host owns resource disposal. Timer-backed policies share
only the underlying timer bound; their defaults, cancellation semantics and error mapping remain
independent. See [invocation ownership](../../docs/design.md).

## Verification

Package tests build the public entry before running. Unit tests follow their source owner; integration
tests qualify independent capabilities, compiled composition and failure ownership. Type fixtures
cover the baseline public symbols, capability narrowing and generic input constraints. Legacy exports
available only for type queries remain type-only and are not promoted into the runtime API.

`pnpm test:model-invocation-qualification` runs the module checks and its architecture tests.
`test/model-invocation-core-source-boundaries.test.ts` uses the shared source checker to scan literal
imports/exports (including type edges), enforce the declared entries/dependency layers and reject
wildcard exports. It also checks pure-type runtime erasure and the baseline public symbol inventory.
Computed imports, runtime ownership and semantic rule completeness still require review.
