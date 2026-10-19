# Agent Memory

Independent memory capabilities, not a common BaseMemory framework. Context Memory owns bounded,
fully rendered documents; other memory types can have separate domains and workflows.

`@ta-agent/context-memory` provides JSON documents, typed ports, validated mutations and eight native
Workflow/Bundle entries. Model-driven observation, editing and compaction use borrowed Model
Invocation capabilities; the deterministic profile requires no model. It does not depend on Agent
Base, Workbench, application runtimes, or a provider. A host maps memory identities to its own application scopes
and owns borrowed resources. See the [API guide](./packages/context-memory/README.md),
[composition and recovery guide](./docs/consumption.md) and
[typechecked host example](./tests/qualification/examples/project-memory.ts).

`@ta-agent/context-memory-sqlite` persists current snapshots and idempotent receipts in one SQLite
transaction. Connections opened by path are owned; explicit connections are borrowed. Its contract
and fault-injection tests cover CAS races, replay, cancellation and uncertain commit recovery.

Run the complete deterministic qualification (domain, adapter, independent consumer and architecture):

```sh
pnpm test:memory-qualification
```

It uses real SQLite, formal deterministic Actors and bundled tokenizers; no external LLM, credentials
or network. These tests establish contracts and lifecycle correctness, not real-model memory quality.
Application integration, Retrieval Memory and cross-memory promotion are separate consumer concerns.
