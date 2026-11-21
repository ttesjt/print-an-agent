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

The npm root exports one factory and three configuration types. Its implementation is organized as:

| Path                                  | Responsibility                                                                   |
| ------------------------------------- | -------------------------------------------------------------------------------- |
| `src/index.ts`                        | Deliberate npm exports                                                           |
| `src/embedder.ts`                     | Configuration/dependency selection and Core capability composition               |
| `src/types.ts`                        | Public factory composition options                                               |
| `src/authentication.ts`               | Shared resolver binding, stable credential snapshot and Authorization resolution |
| `src/configuration/index.ts`          | Configuration feature entry                                                      |
| `src/configuration/prepare.ts`        | Closed data records, adapter target and authentication configuration             |
| `src/configuration/representation.ts` | Symmetric recipes and Core representation input construction                     |
| `src/configuration/types.ts`          | Public configuration and internal preparation-stage contracts                    |
| `src/http/index.ts`                   | HTTP execution entry                                                             |
| `src/http/request.ts`                 | Input admission, credentials, POST/status handling and response cleanup          |
| `src/http/protocol.ts`                | Pure request encoding and response validation/index association                  |
| `src/http/response-body.ts`           | Bounded byte ownership, UTF-8/JSON parsing and reader lifecycle                  |

Configuration preparation validates the adapter target while representation, limits and policy
remain Core inputs. HTTP receives a minimal target contract and numeric dimensions from Core's
validated, frozen descriptor. Final result validation, representation identity and request-order
sorting remain Core responsibilities. The invocation callback reads that descriptor only after
Core has successfully returned the capability.

Configuration and HTTP expose explicit internal feature entries. HTTP consumes the shared
Authentication file entry and Configuration's type contracts; its compiled JavaScript does not
load Configuration. Authentication depends only on Core. Children do not import the package's
composition contracts or root aggregate. These internal entries do not create npm subpaths.

Resolver methods are captured once with their original receiver. Each call resolves fresh
credentials and captures fields once; the validated snapshot supplies Authorization. Empty wire
text fails before credential or network work. Requests reject redirects and return all-or-nothing
batches. The response reader stays cohesive: accepted chunks are copied before the next read,
limits precede JSON parsing, and cancellation/error/success paths release their owned resources.
Borrowed clients and resolvers remain host-owned.

Unit tests follow Configuration, Authentication and HTTP responsibilities. Test support separates
server lifecycle from configuration builders and wire data; a separate program consumes compiled
package entries. `test` builds the package before executing that consumer, so deleting this
package's `dist` does not require a manual rebuild. Workspace dependencies still need the normal
repository prerequisite build. Type fixtures retain the public contract and tests reject an empty
suite.

`test/embedding-http-source-boundaries.test.ts` declares the opted-in feature entries, shared
Authentication entry, type erasure and dependency directions. It also checks export/dependency
metadata, public symbols, compiled Configuration dependency erasure and Core-facing public
declarations. It runs in architecture and Model Invocation qualification. Literal import edges,
including type-only edges, are checked; computed loading, runtime ownership and failure ordering
still require review.
