# Agent Memory

Independent memory capabilities, not a common BaseMemory framework. Context Memory owns bounded,
fully rendered documents; other memory types can have separate domains and workflows.

`@ta-agent/context-memory` defines JSON documents, typed ports, deterministic validation, model edit
operations and configurable policies. It does not depend on Agent Base, Workbench, application runtimes, or a
provider. A host maps memory identities to its own application scopes and owns borrowed resources.

`@ta-agent/context-memory-sqlite` persists current snapshots and idempotent receipts in one SQLite
transaction. Connections opened by path are owned; explicit connections are borrowed. Its contract
and fault-injection tests cover CAS races, replay, cancellation and uncertain commit recovery.

Run the implemented domain and adapter checks with:

```sh
pnpm --filter './modules/agent-memory/**' typecheck
pnpm --filter './modules/agent-memory/**' test
pnpm exec eslint modules/agent-memory test/memory-architecture.test.ts
pnpm exec vitest run test/memory-architecture.test.ts
```
