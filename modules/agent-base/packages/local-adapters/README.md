# @print-an-agent/base-local-adapters

Official local and in-process implementations of generic Agent Base ports.

This package contains the reusable Memory and SQLite adapters selected by the official composition
and standalone application packages. Domain packages define the ports and invariants; importing this
package is optional for consumers that provide their own implementations.

Shipped implementations are grouped by the port they implement:

- Identity: Memory and versioned SQLite catalog adapters;
- Config: Memory and versioned SQLite document adapters;
- Session: Memory and SQLite navigation/compaction/query/metadata/presentation adapters with durable recent-activity ordering;
- Request: Memory OutputSink plus Memory and SQLite Request Journals;
- Observability: bounded Memory trace storage.

Each SQLite family owns its own options, validation, schema, migrations, SQL, and failure mapping.
There is intentionally no shared SQLite superclass or universal adapter interface. Constructors
accept an optional `tablePrefix` and typed exact `tableNames` overrides; defaults use neutral
`agent_` names. SQLite paths are explicit and reject symbolic links.

```ts
import { SqliteSessionAdapter } from '@print-an-agent/base-local-adapters';

const session = new SqliteSessionAdapter({
  databasePath: '/explicit/application/data/agent.sqlite',
  tablePrefix: 'product_',
  tableNames: { sessions: 'conversations' },
});
```

The package is intentionally bounded to local adapters. Remote services, product-owned persistence,
Pi-backed execution, and Standalone-owned namespace lifecycle implementations belong in their own
integration or application packages.

Session presentation commits atomically with the completed assistant turn and branch head. Memory
keeps display records separately from message snapshots; SQLite stores a nullable presentation
column on the same turn row inside the completion transaction. No sidecar database or independently
named presentation table is needed. Existing table-prefix and per-table naming options apply.
SQLite Session uses storage schema v5. Initialize mode can upgrade the supported v4 layout by
adding Session Memory coordination storage; other unsupported versions are rejected. Existing mode
requires a complete v5 schema and does not upgrade it. Malformed current schemas are rejected rather
than silently repaired. Presentation reads are opt-in and bounded; history and compaction never
select this content as model input.

## Session lifecycle and coordinated persistence

Memory and SQLite Session adapters implement independent lifecycle/query/execution capabilities:
active/retired lists, inspection, metadata-CAS retire/restore, explicit purge, and recovery. Lists
exclude execution-fence evidence; inspect provides it. Every runtime mutation requires a live
`execution` lease; raw adapter consumers must acquire it and release only after all their work settles.
Official request, compaction and navigation Workflows perform this propagation automatically.
Reads need no lease. Retired Sessions retain history but reject runtime admission and writes.

For a runtime using both Session and Request Journal, choose a coordinated profile:

```ts
import { createSqliteSessionPersistence } from '@print-an-agent/base-local-adapters';

const persistence = createSqliteSessionPersistence({
  databasePath: '/explicit/application/data/agent.sqlite',
  session: { tablePrefix: 'product_' },
  requestJournal: { tablePrefix: 'product_' },
});
// Inject persistence.session and persistence.requestJournal into composition.
// persistence.maintenance.purgeSessionPersistence(...) deletes both domains atomically.
// persistence.maintenance.recoverSessionPersistence(...) recovers both domains under one fence.
```

`createMemorySessionPersistence` provides the same observable scope using an isolated in-process
queue. The SQLite profile uses same-database transactions. Composite purge atomically removes the
Session aggregate and its Journal records; traces, attachments and other product resources are not
included. Session adapters' own purge/recovery remain Session-only. Independently injected adapters
do not acquire a composite atomicity guarantee merely by implementing the two ports.

The SQLite Session, Request Journal and coordinated persistence constructors default to
`schemaMode: 'initialize'`. Use `schemaMode: 'existing'` for a management reader that must not
create a missing Session or Journal table family. This requires both selected schemas to exist and
fails on a missing or invalid schema.

`CoordinatedSessionMaintenance` deliberately uses different method names from `SessionPurgePort`
and `SessionExecutionRecoveryPort`. It cannot be structurally injected as a Session-only capability,
which would silently expand that caller's deletion scope. Memory's coordination hooks are internal
implementation methods and are omitted from generated public declarations.

Recovery is explicit operator action with execution-revision CAS. It revokes old credentials,
preserves completed Turns/responses, and marks active Turns/Journal entries interrupted. Failure
retains recovering/busy state until explicit retry. There is no timeout-based unlock, replay
synthesis, automatic model/tool retry, or rollback of external side effects. SQLite preserves
occupancy across restart; Memory is a process-local development profile.

Default in-process composition selects the coordinated Memory pair when neither port is supplied.
Official Standalone SQLite runtime profiles select the coordinated SQLite pair. The namespace-based
Standalone Session management service selects the existing-schema mode; no lifecycle methods are
added to Agent, AgentAPI, Agent Operations, or the Agent registry.
