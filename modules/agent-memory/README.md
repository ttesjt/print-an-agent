# Agent Memory

Independent memory capabilities, not a common BaseMemory framework. Context Memory owns bounded,
fully rendered documents; other memory types can have separate domains and workflows.

`@print-an-agent/retrieval-memory` provides independently indexed Spaces, authoritative Entries, semantic
search and exact-budget context projection through eleven native Workflow/Bundle entries.
`@print-an-agent/retrieval-memory-sqlite` supplies an owned worker-backed SQLite/vec0 adapter with atomic
publication and receipts. Embedding is borrowed from Model Invocation, not a generation Actor.
See the [Retrieval Memory guide](./packages/retrieval-memory/README.md) and its
[typechecked host composition](./tests/retrieval-memory-qualification/examples/project-knowledge.ts).

`@print-an-agent/context-memory` provides JSON documents, typed ports, validated mutations and native
Workflow definitions with explicit Bundle profiles. Model-driven observation, editing and compaction use borrowed Model
Invocation capabilities; the deterministic profile requires no model. It does not depend on Agent
Base, Workbench, a product runtime, or a provider. A host maps memory identities to its own application scopes
and owns borrowed resources. See the [API guide](./packages/context-memory/README.md),
[composition and recovery guide](./docs/consumption.md) and
[typechecked host example](./tests/qualification/examples/project-memory.ts).

`@print-an-agent/context-memory-sqlite` persists current snapshots and idempotent receipts in one SQLite
transaction. Connections opened by path are owned; explicit connections are borrowed. Its contract
and fault-injection tests cover CAS races, replay, cancellation and uncertain commit recovery.

Run complete qualification (domains, adapters, independent consumers and architecture):

```sh
pnpm test:memory-qualification
```

It uses real SQLite, formal deterministic model fixtures, bundled tokenizers and a localhost HTTP
embedding fixture; no external model service, credentials or weight download. Localhost listening
permission is required for the protocol tests. These tests establish contracts and lifecycle
correctness, not real-model memory quality. Product integration and cross-memory promotion remain
separate consumer concerns.

## SQLite adapter source ownership

Context Memory SQLite and Retrieval Memory SQLite share the same source organization roles. Each
adapts its main package's public Port, owns its native database implementation and keeps domain
storage features inside that database boundary. The main packages continue to own memory contracts,
validation and decisions.

| Responsibility                  | Context Memory SQLite                                    | Retrieval Memory SQLite                                  |
| ------------------------------- | -------------------------------------------------------- | -------------------------------------------------------- |
| Named package API               | `src/index.ts`                                           | `src/index.ts`                                           |
| Domain Port facade              | `src/store/`                                             | `src/backend/`                                           |
| Database capability entry       | `src/database/index.ts`                                  | `src/database/index.ts`                                  |
| Native connection               | `src/database/connection/`                               | `src/database/connection.ts`                             |
| Persisted records               | `src/database/persistence/`                              | `src/database/persistence/`                              |
| Atomic publication and recovery | `src/database/publication/`                              | `src/database/publication/`                              |
| Domain storage capabilities     | `src/database/history/`, including Delta                 | `src/database/content/`, `search/` and `vector-index.ts` |
| Execution and resources         | Host-local synchronous SQL; owned or borrowed connection | Dedicated `src/worker/`; owned Worker and connection     |

Store consumes Database's selected public capabilities. Retrieval's Backend reaches those
capabilities through its Worker client and runtime. Database composition uses child feature entries;
children use sibling public APIs or explicitly shared ancestor capabilities. Independent types stay
with their owning feature under the [code standards](../../docs/standards/code-standards.md#g2-recursive-features-and-resource-scope).

Keep the facade names tied to the main package's Ports: `MemoryHistoryStore` and `RetrievalBackend`.
Connection may be one file or several modules as its responsibilities require. Worker code owns the
thread lifecycle where the adapter uses one. Each adapter owns native transaction execution,
persisted formats and storage recovery, following its main package's publication contracts and
domain decisions. Model calls and token measurement happen outside native transactions.

This convention covers these two Agent Memory adapters. The package guides describe their concrete
ownership and lifecycle contracts:
[Context Memory SQLite](./packages/context-memory-sqlite/README.md#source-ownership) and
[Retrieval Memory SQLite](./packages/retrieval-memory-sqlite/README.md#source-ownership).
