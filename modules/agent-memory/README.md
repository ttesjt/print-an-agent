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
