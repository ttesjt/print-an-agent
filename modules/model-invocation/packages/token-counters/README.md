# Token counters

Optional implementations of the Model Invocation text measurement contract. Core does not depend on
this package. Both factories return `TokenCounter<TextTokenInput>`; neither counts whole chat
requests, media, provider framing or billing.

- `createTiktokenTextCounter({ encoding: TIKTOKEN_ENCODING.CL100K_BASE })` (or `O200K_BASE`)
  counts ordinary text exactly under the selected, pinned js-tiktoken vocabulary. Literal special-token
  strings are treated as ordinary text. Vocabulary initialization is lazy, local and shared only within
  that counter instance. No model-name inference, network download or fallback is performed.
- `createCharacterTokenEstimator({ charactersPerToken: 4 })` reports an explicit estimate:
  `ceil(text.length / charactersPerToken)`, using UTF-16 code units. This heuristic is not an exact
  tokenizer and cannot prove a hard model token budget. The ratio defaults to the exported
  `DEFAULT_CHARACTERS_PER_TOKEN`.

Measurement identity includes algorithm/version, vocabulary and counting options. Consumers decide
whether estimated accuracy is acceptable. Host code owns counter lifetime; no dispose is needed.
Cancellation is checked before and after local work; synchronous encoding cannot be interrupted
mid-call by JavaScript. Unsupported inputs fail instead of being partially counted.

## Declarative selection

`defineTextTokenCounterConfig(unknown)` validates and freezes one of:

```ts
{ kind: 'tiktoken', encoding: 'cl100k_base' } // or o200k_base
{ kind: 'character-estimator', charactersPerToken: 4 }
{ kind: 'reference', measurementRef: 'my-encoding:options-identity' }
```

The corresponding `TEXT_TOKEN_COUNTER_KIND` constants are exported for TypeScript callers.
`resolveTextTokenCounterConfig(config, resolveReference?)` materializes the official implementations
or performs an explicit synchronous host lookup of an already-loaded capability. The returned
descriptor must match the requested reference. There is no global registry, model-name guessing,
fallback, arbitrary module loading, or credential discovery. Initialize asynchronous custom resources
before passing their lookup to composition. Unknown/unavailable bindings fail with
`TOKEN_MEASUREMENT_BINDING_INVALID`. Encoding/rank loading stays lazy and local.
