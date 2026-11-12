# Retrieval Memory

An independent, multi-Space retrieval capability built from native Workflow definitions and one shared
Workflow Bundle. No Context Memory base class, Agent runtime, generation Actor or provider dependency.

## Concepts

- **Space** (`memoryId`): caller-chosen namespace; not a path, database or authorization boundary.
- **Entry**: authoritative text, JSON metadata and optional source, with its own revision.
- **Chunk / representation**: derived searchable text and vectors, replaceable without rewriting Entry content.
- **Publication**: one conditional visibility boundary for content, representations, Space sequence and durable receipt.

Space index configuration is immutable in this profile. It binds formal Embedding representation,
chunker and metric identities. Dimensions alone do not establish compatibility. Single-Entry reindex
does not change this configuration or the Entry revision.

## Assembly

The host creates and owns its backend/model/client, supplies a formal
`@print-an-agent/model-invocation-core` TextEmbeddingCapability, and optionally an exact text TokenCounter.
Use `@print-an-agent/model-invocation-embedding-http` in the host when appropriate; Memory does not choose
an endpoint, download weights, discover credentials or supply a fake production model.

```ts
import {
  COSINE_METRIC_REF,
  createCodepointChunker,
  createRetrievalMemoryBundle,
  createRetrievalWorkflowResources,
} from '@print-an-agent/retrieval-memory';

// backend, embedder and counter are explicitly supplied, host-owned capabilities.
const chunker = createCodepointChunker();
const resources = createRetrievalWorkflowResources(
  {
    backend,
    embeddings: { resolve: () => embedder },
    chunkers: { resolve: () => chunker },
  },
  {
    context: { counter },
    execution: { timeoutMilliseconds: null },
    policy: { maxEntryCodepoints: 100_000 },
  }
);
const { workflows } = createRetrievalMemoryBundle({ resources });
await workflows.create.run({
  input: {
    memoryId: 'project:example',
    requestId: 'create:1',
    index: {
      embeddingRef: embedder.descriptor.representationRef,
      chunkerRef: chunker.ref,
      metricRef: COSINE_METRIC_REF,
    },
  },
});
const saved = await workflows.ingest.run({
  input: {
    memoryId: 'project:example',
    requestId: 'note:1',
    content: 'Publish content and its retrieval representation together.',
    source: { ref: 'design:publication' },
  },
});
const context = await workflows.readContext.run({
  input: { memoryId: 'project:example', query: 'How does publication work?', maxTokens: 1024 },
  signal,
});
if (context.status === 'completed') console.log(context.value.text);
```

See the [typechecked host composition](../../tests/retrieval-memory-qualification/examples/project-knowledge.ts).
Resource assembly performs no I/O. Bundles borrow resources; the host joins its Workflow/model runs
before closing its own backend or model. One Bundle serves many Spaces, and independent Bundles can
share a backend. Resolver and model calls receive the current Run signal.

## Workflows and results

| Workflow         | Behavior                                                          |
| ---------------- | ----------------------------------------------------------------- |
| create / inspect | Explicitly create an empty Space; read its manifest/view          |
| ingest           | Create one Entry with system-generated identity                   |
| update           | Full content/metadata/source replacement using expectedRevision   |
| remove           | Permanently remove one Entry and its searchable representation    |
| get / list       | Full Entry read; paginated summaries without content              |
| search           | Chunk-level semantic hits, with view, source and ranking evidence |
| readContext      | Whole-chunk selection, rendering, citations and exact budget      |
| reindex          | Synchronous same-configuration rebuild of one Entry               |
| getReceipt       | Recover a durable request outcome                                 |

All mutations require `requestId`. Update/remove/reindex also require Entry ID and expected revision.
Omitted update metadata/source replace them with `{}`/null; this is not a patch. Identical update
content produces an unchanged receipt without embedding. No implicit create, deduplication or upsert.

Writes return `{ status: 'committed' | 'unchanged', receipt }`; explicit Workflow skipping returns
`{ status: 'skipped', reason }`. Reads return `{ status: 'completed', value }` or skipped. The Core
Workflow owns execution; these result unions do not introduce another runner. Each definition is
also directly constructible with `new Workflow({ ...definition, resources })`.

## Correctness and recovery

- Successful writes are published and searchable by subsequent new reads. Deletes remove subsequent visibility.
- Requests use canonical business input identities. Same request replays its original receipt even after later changes;
  reusing its ID for other input fails. Conflict retries and provider fallbacks are not implicit.
- Errors distinguish not-committed, committed-with-receipt and unknown. Inspect `findRetrievalCommit(error)`
  when Core aggregates independent failures. Executor/hooks cannot erase a known receipt.
- An unknown result requires receipt recovery or replay of the **same** request. `getReceipt` returning undefined
  is not proof that an in-flight request rolled back. Never blindly retry under a new request ID.
- Inputs and derived text must be well-formed Unicode. No trimming/normalization or lossy surrogate repair.
- The cosine profile stably normalizes in binary64 before float32 conversion, on both document and query sides.
  Final publication/query guards reject unsafe vectors even if preparation Steps are replaced.

## Retrieval and context policy

Filters support object-property paths with `eq`, `in`, `exists` and `and`. Types are strict; missing is
not null and true is not 1. Arrays are not traversed as objects. Filtering constrains the eligible set
before topK. Scores are metric values, not confidence. Cutoff ties need not select a globally ID-sorted subset.

List uses UTF-8 Entry ID order and scoped opaque cursors. A same-Space write invalidates the previous
page view with STALE_CURSOR; unrelated Space changes do not. Search itself is not paginated.

Default readContext: 20 candidates, at most 8 chunks, 4096 tokens, numbered citations and `\n\n`
separator. It measures complete rendered text, not additive chunk estimates. Oversized chunks are
skipped while later candidates are considered. Empty retrieval differs from `no-chunk-fits`.
Finite budgets require an exact/text TokenCounter; `maxTokens: null` disables the budget and returns
no invented measurement. Renderer/selection replacement still goes through final membership,
provenance and budget checks. Retrieved text is untrusted data, not privileged instructions.

Defaults and optional size limits are centralized and configurable (nullable limits can be disabled).
Actual adapter/model limits, schema, CAS, scope and numerical guards cannot be disabled. Operation
deadlines default to null; cancellation is cooperative and does not abandon hidden work.

## Extension boundaries

Replace formal Embedding, chunker, renderer or coherent backend ports; override named Steps; or
replace complete definitions through `workflows` in Bundle options. Mutation preparation is separate
from guarded publication, and context search/select/finalize are separate named Steps. Backend adapters
must run `decideRetrievalPublication` inside their actual atomic visibility boundary, with request
arbitration before CAS. Arbitrarily combining unrelated content and vector stores is not sufficient.

The [SQLite adapter](../retrieval-memory-sqlite/README.md) provides the default local data profile.
Other backends need no path/SQLite API, but must provide the same synchronous visibility and truthful
commit results. No extraction LLM, parsing/crawling, hybrid/rerank, cross-memory promotion, model
migration or background jobs are implied by this release.
