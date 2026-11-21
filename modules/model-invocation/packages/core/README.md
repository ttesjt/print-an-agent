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
