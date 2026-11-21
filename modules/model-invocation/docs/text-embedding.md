# Text embedding

Text embedding is an independent model-invocation capability, not a generation Actor mode.
`@print-an-agent/model-invocation-core` exports its contracts, error class, task constants and
`createTextEmbedder()`. Optional HTTP execution lives in
`@print-an-agent/model-invocation-embedding-http`. Neither requires an Agent, Session, Workflow, catalog,
generation capability, vector database or retrieval metric.

## Public contract

```ts
interface TextEmbeddingCapability {
  readonly descriptor: TextEmbeddingDescriptor;
  readonly embed: (request: TextEmbeddingRequest) => Promise<TextEmbeddingResult>;
}

interface TextEmbeddingRequest {
  readonly task: EmbeddingTask;
  readonly inputs: readonly TextEmbeddingInput[];
  readonly signal: AbortSignal;
}

interface TextEmbeddingInput {
  readonly id: string;
  readonly text: string;
}

interface TextEmbeddingResult {
  readonly representationRef: string;
  readonly task: EmbeddingTask;
  readonly embeddings: readonly TextEmbeddingVector[];
}

interface TextEmbeddingVector {
  readonly id: string;
  readonly vector: readonly number[];
}
```

Use the exported `EMBEDDING_TASK.DOCUMENT` and `EMBEDDING_TASK.QUERY` values. A batch has one task and
at least one input. Single-input calls use a one-element batch. IDs are unique within the batch and
use 1–256 ASCII characters: an initial alphanumeric followed by alphanumerics, `.`, `_`, `:`, `/` or
`-`. Text must contain well-formed Unicode. Whitespace, supplementary characters and canonical
equivalents are preserved, not trimmed or implicitly normalized. Core permits empty text; an adapter
may reject it before execution when its wire/model protocol disallows it.

Official construction validates and snapshots input, checks declared limits, validates all returned
vectors and returns a detached, deeply frozen result. Implementations return only ID/vector entries;
they cannot override the bound representation identity. Responses can arrive in any order, but the
returned batch always follows request order. Missing, extra, duplicate or unknown IDs reject the
whole invocation. Success is never partial success. There is no implicit retry, batch splitting,
fallback model, truncation, serialization or caching.
The batch-size bound is checked from the array header before enumerating or copying entries.

Vectors contain finite JavaScript numbers with exactly the declared dimensions. Core copies values
without quantization or normalization, accepts zero vectors, and does not select a similarity metric.
An index consumer owns any additional numerical preparation. A structurally valid response is not
proof of semantic model quality or a model's honest identity.

## Descriptor and representation identity

```ts
interface TextEmbeddingRepresentation {
  readonly modelRef: string;
  readonly dimensions: number;
  readonly preprocessingRef: string;
  readonly documentRecipeRef: string;
  readonly queryRecipeRef: string;
  readonly outputTransformRef: string;
}

interface TextEmbeddingLimits {
  readonly maxBatchSize: number | null;
  readonly maxInputUtf8Bytes: number | null;
  readonly maxBatchUtf8Bytes: number | null;
}

interface TextEmbeddingDescriptor {
  readonly representationRef: string;
  readonly representation: TextEmbeddingRepresentation;
  readonly inputKind: 'text';
  readonly tasks: readonly EmbeddingTask[];
  readonly limits: TextEmbeddingLimits;
}
```

Dimensions and finite limits are positive safe integers. All three limit fields are required;
`null` means unknown/not locally bounded, not unlimited model capacity. UTF-8 limits count original
text bytes, excluding HTTP framing or adapter-added model recipes. A known limit violation fails
before implementation execution. The implementation must additionally validate any known
model/recipe-specific limits, including constraints on its transformed input. Unknown restrictions
must be documented; provider rejections are not successful embeddings.

Core computes a domain-separated SHA-256 digest from the fixed-order representation fields and
exposes `text-embedding:sha256:<digest>`. The descriptor is detached and immutable. Model/version,
dimensions, preprocessing, either task recipe or output transformation changes the identity.
Document and query recipes jointly identify one representation space; they may be asymmetric and
need not produce equal vectors for equal text. Equal dimensionality alone never implies compatibility.

References follow the same bounded identifier grammar as input IDs. They must version the actual
implementation behavior; function source is not introspected or hashed. In particular, a host that
cannot verify remote weights must supply a versioned `modelRef` and keep its endpoint binding true.
This is a configuration commitment, not weight verification. Changing a remote alias without changing
the reference cannot be detected by Core. Conversely, matching digests do not prove identical remote
execution, determinism or numerical accuracy.

Endpoint, provider address, API key, credential reference, deadline and operational size limits do
not enter representation identity. Moving the same encoding to another endpoint or rotating a key
does not by itself require rebuilding an index. Hosts must include any deployment-specific behavior
that actually changes encoding in their model/recipe reference commitments.

## Custom implementation

```ts
import {
  createTextEmbedder,
  EMBEDDING_TASK,
  type TextEmbedderDefinition,
} from '@print-an-agent/model-invocation-core';

const definition: TextEmbedderDefinition = {
  representation: {
    modelRef: 'my-model:immutable-weights-reference',
    dimensions: 768,
    preprocessingRef: 'my-preprocessing:1',
    documentRecipeRef: 'my-document-recipe:1',
    queryRecipeRef: 'my-query-recipe:1',
    outputTransformRef: 'my-output:identity',
  },
  limits: {
    maxBatchSize: 32,
    maxInputUtf8Bytes: null,
    maxBatchUtf8Bytes: null,
  },
  async embed({ task, inputs, signal }) {
    // The borrowed backend owns model-specific recipes and additional input checks.
    return backend.encode({ task, inputs, signal });
  },
};

const embedder = createTextEmbedder(definition);
const result = await embedder.embed({
  task: EMBEDDING_TASK.QUERY,
  inputs: [{ id: 'query', text: 'A question' }],
  signal,
});
```

`backend` and `signal` above are supplied by the application. A custom backend receives the declared
task and original text; model-specific prefixes/parameters belong there, not in generic consumers.
Use the typed definition for contextual implementation typing. The factory also accepts unknown
bindings for runtime parsing; data records are closed and getters, hidden/symbol fields and malformed
arrays are rejected. Only implementations built through the formal factory or official adapters
receive these wrapper guarantees. An arbitrary structural implementation remains trusted host code.

## Cancellation, deadlines and resources

Every invocation requires a standard `AbortSignal`. It is passed to actual backend/HTTP execution.
The native signal brand is validated; prototype-only imitations are invalid input, not cancellation.
Pre-cancelled calls do not execute the implementation. Post-settlement cancellation checks prevent
late success from an implementation that ignored cancellation. An optional
`invocationPolicy: { timeoutMilliseconds: number | null }` adds a local wall-clock deadline.
The default is `NO_EMBEDDING_TIMEOUT` (`null`); finite deadlines must be positive integers no larger
than `MAX_EMBEDDING_TIMEOUT_MILLISECONDS`.

Local cancellation never aborts a parent or another invocation. Parent cancellation retains its
exact reason as the cancellation error's cause. Even a parent's `TimeoutError` is not attributed to
this invocation's own deadline. Only this boundary's own deadline produces
`EMBEDDING_INVOCATION_TIMEOUT`. The timer propagates cancellation; a monotonic elapsed-time check
also enforces the deadline at settlement, including synchronous backend work, response parsing and
result validation. A starved timer cannot turn an expired result into success, and civil-clock
adjustments do not change the elapsed budget. An already observed cancellation keeps its existing
ownership/reason rather than being replaced by a retroactive local timeout. Timers/listeners are
removed on success, failure and cancellation.

Cancellation is cooperative: arbitrary custom implementations must honor signals and settle their
work. The wrapper does not abandon in-flight work via a Promise race or claim to kill uncooperative
code. A borrowed model, resolver or fetch/client belongs to its host. The host closes shared
resources after accepted work settles. Neither Core nor the HTTP capability has a required `close()`
method or public disposable framework.

## Stable errors

| Code                             | Meaning                                                                        |
| -------------------------------- | ------------------------------------------------------------------------------ |
| `EMBEDDING_BINDING_INVALID`      | Invalid definition, representation, limits, policy or HTTP configuration       |
| `EMBEDDING_INPUT_INVALID`        | Malformed request/task/IDs/text/signal, or unsupported wire input              |
| `EMBEDDING_INPUT_LIMIT_EXCEEDED` | Declared byte/batch limit exceeded                                             |
| `EMBEDDING_RESPONSE_INVALID`     | Incomplete/malformed batch, invalid vector, invalid or oversized wire response |
| `EMBEDDING_PROVIDER_FAILED`      | Backend/HTTP/transport/credential execution failed                             |
| `EMBEDDING_INVOCATION_CANCELLED` | Parent signal cancelled this call; original reason is `cause`                  |
| `EMBEDDING_INVOCATION_TIMEOUT`   | This invocation's own configured deadline expired                              |

All codes belong to exported `EmbeddingError` / `EmbeddingErrorCode`. Unknown implementation failures
retain their original `cause`; deliberate structured `EmbeddingError`s are preserved. Implementations
must keep their own structured messages safe. The HTTP adapter's credential failures retain the
existing `ModelInvocationError` credential code in `cause`, beneath `EMBEDDING_PROVIDER_FAILED`.
Official public messages do not include input text, API keys or raw response bodies. Causes are
private diagnostics and may contain provider/resolver details: do not serialize them to clients or
logs indiscriminately.

## HTTP adapter

```ts
import { EMBEDDING_TASK } from '@print-an-agent/model-invocation-core';
import { createHttpTextEmbedder } from '@print-an-agent/model-invocation-embedding-http';

const embedder = createHttpTextEmbedder({
  config: {
    endpoint, // Full http(s) embeddings URL supplied by the host.
    provider: 'my-provider',
    model: 'my-embedding-model',
    modelRef: 'my-embedding-model:host-bound-revision',
    dimensions: 768,
    authentication: { kind: 'keyless' },
    limits: {
      maxBatchSize: 32,
      maxInputUtf8Bytes: null,
      maxBatchUtf8Bytes: null,
    },
    maxResponseBytes: 1_048_576,
    sendDimensions: false,
  },
});

const result = await embedder.embed({
  task: EMBEDDING_TASK.DOCUMENT,
  inputs: [{ id: 'doc', text: 'Document text' }],
  signal,
});
```

The values above are example host choices, not built-in model/size/endpoint defaults. Configuration is
closed, explicit and data-only. URLs cannot contain userinfo, query parameters or fragments. The
adapter sends `POST` to the exact URL with `{ model, input: string[], encoding_format: 'float' }`.
`sendDimensions: true` also sends `dimensions`; use it only for endpoints/models that support that
parameter. Without it, dimensions still validate every returned vector. There is no dimension
discovery or automatic shortening. See the [OpenAI Embeddings wire definition](https://developers.openai.com/api/reference/resources/embeddings/methods/create).

The first HTTP implementation is symmetric. Both tasks send unmodified text, share
`unicode-text:identity` preprocessing and `provider-numbers:identity` output transformation, and use
the same document/query recipe. The recipe is
`openai-compatible:float:model-default-dimensions` when `sendDimensions` is false, or
`openai-compatible:float:explicit-dimensions` when true. These are distinct representation identities
even if their declared dimensions are equal: a compatible service may use different projection or
normalization paths for the two request modes. No generic task parameter, chat instructions or
provider-specific prefix is inferred.
For a model that requires an asymmetric recipe, supply an appropriate custom capability rather than
pretending this symmetric adapter provides it. Request-shape compatibility alone does not establish
that a model's embedding recipe is appropriate.

Responses must use `object: 'list'`, echo the exact configured model, and contain one
`{ object: 'embedding', index, embedding: number[] }` per input. Indices are validated before mapping
to Core IDs. A different reported model is rejected, not accepted as fallback. Exact model echo is
an additional consistency check, not verification of remote weights. Alias endpoints reporting a
different model name must use a suitable explicit model binding or another adapter.

`maxResponseBytes` is required and bounds advertised and streamed response size before JSON parsing;
it is operational safety, not model capacity. Non-2xx status is a provider failure; its body is not
exposed. Malformed JSON/UTF-8, non-finite values, incorrect dimensions, indices or model echoes fail
closed. Response readers are released and unfinished bodies cancelled, including error and abort
paths. Requests never follow redirects, preventing implicit target changes or credential forwarding.
Accepted byte chunks are copied into owned Uint8Array storage before the next read, including Buffer
chunks from borrowed transports; subsequent producer buffer reuse cannot change the decoded vectors.

For authenticated endpoints replace keyless configuration with
`{ kind: 'credential-reference', credentialRef: 'my-key' }` and supply a borrowed
`ProviderCredentialResolver` as `credentialResolver`. The adapter calls `resolve({ reference,
provider, signal })`, validates a nonempty API key, and sets `Authorization: Bearer ...` for that
request. Resolver methods are captured once at binding and retain their receiver. Each invocation
captures credential fields once, validates that snapshot and uses the same values for authentication;
field-read failures retain their cause under the credential-resolution error. There is no ambient environment/key discovery. Keyless calls do not invoke a resolver or
send an Authorization header.

An optional borrowed `fetch` function supports host-managed clients and controlled transports; bind
its receiver before injection if required. It must honor the supplied signal and normal Response
body semantics. The capability does not close its connection pool. There are no implicit retries or
adapter-added deadlines; underlying transports/services may have their own limits.

The adapter has no model catalog/tokenizer and does not infer token capacity from a model name.
Configured byte/batch limits are checked locally; other model restrictions may be unknown and must
be enforced by the service or an appropriate stricter adapter. The adapter never truncates locally.
For endpoints that silently truncate, configure that server to reject oversize input or use a
different adapter with an explicit no-truncation mechanism. A generic successful response cannot
prove that an unknown remote service did not truncate or substitute weights.
