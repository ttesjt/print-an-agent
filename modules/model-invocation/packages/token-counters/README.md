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

Configuration is captured once from the caller's closed data record. Variant-specific field
validation and normalization operate on that same snapshot, including when the caller supplies a
Proxy whose later observations differ. Accessors, hidden fields and symbol fields remain invalid.

The implementation has explicit owners:

| Path                           | Responsibility                                                    |
| ------------------------------ | ----------------------------------------------------------------- |
| `src/index.ts`                 | The only npm entry; seven runtime values and six named types      |
| `src/option-record.ts`         | Shared closed-record inspection and immutable snapshots           |
| `src/character-estimator.ts`   | Cohesive ratio/default validation and UTF-16 estimator            |
| `src/tiktoken/index.ts`        | Tiktoken feature entry                                            |
| `src/tiktoken/encoding.ts`     | Supported encodings, derived types/options and validation         |
| `src/tiktoken/counter.ts`      | Counter identity, instance-local lazy initialization and encoding |
| `src/configuration/index.ts`   | Configuration feature entry                                       |
| `src/configuration/options.ts` | Controlled kinds and derived input/normalized variants            |
| `src/configuration/define.ts`  | Single-snapshot variant validation and normalization              |
| `src/configuration/resolve.ts` | Synchronous implementation dispatch and host reference binding    |

Configuration consumes counter entries and the shared record reader. Counter implementations never
depend on Configuration; the record reader depends on neither. Small implementation-specific Options
and the synchronous resolver contract stay beside their owner. Controlled runtime options and their
derived types stay together. Internal feature/file entries do not add npm subpaths.

A counter owns its initialization outcome, including failure; the instance does not automatically
reinitialize or fall back. Cancellation of one measurement does not cancel shared initialization or
another measurement. Real SDK/rank instrumentation tests cover import/construction laziness, selected
vocabulary, concurrent initialization and per-instance isolation; exact-count integration tests still
use the real pinned vocabularies. Synchronous encoding remains cooperative at its pre/post checks.

Unit tests follow Configuration, Tiktoken and Character estimator responsibilities. A separate
process consumes compiled public exports and both vocabularies; type fixtures cover normalized and
readonly/discriminated contracts. `test` builds this package first, and `clean` removes its generated
outputs. Workspace dependencies need the normal prerequisite build.

`test/token-counters-source-boundaries.test.ts` declares feature entries, shared file capabilities,
dependency direction and accepted/rejected literal imports, including type-only edges. It also checks
public symbols, export/dependency metadata, absence of direct SDK imports in compiled configuration
and Core-facing public declarations. It runs in `pnpm test:architecture` and
`pnpm test:model-invocation-qualification`. Runtime cache ownership, failure/cancellation ordering,
computed imports and arbitrary loaders remain review concerns beyond those static checks.
