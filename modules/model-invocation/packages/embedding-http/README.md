# HTTP Text Embedding

`@print-an-agent/model-invocation-embedding-http` exports `createHttpTextEmbedder()` and typed HTTP
configuration. It creates Core's independent `TextEmbeddingCapability` using an explicitly configured
OpenAI-compatible embeddings endpoint. No Actor, Agent, Session, Workflow, Pi or model download is
required.

The adapter supports batched text, symmetric document/query encoding, strict result association,
keyless or credential-reference authentication, cancellation and an optional invocation deadline
(default `null`). It does not normalize vectors, choose a similarity metric, silently truncate,
discover a model/tokenizer or follow redirects. The host supplies a versioned model identity;
remote weights are not automatically verified.

See the [text embedding API](../../docs/text-embedding.md) for construction examples, configuration,
representation identity, errors, limits and resource ownership. Run
`pnpm test:model-invocation-qualification` at the repository root to build and test public exports,
including the controlled localhost HTTP and independent consumer fixtures. These fixtures validate
protocol mechanics, not real-model semantic quality.
