# @ta-agent/base-local-adapters

Official local and in-process implementations of generic Agent Base ports.

This package contains the reusable Memory and SQLite adapters selected by the official composition
and standalone application packages. Domain packages define the ports and invariants; importing this
package is optional for consumers that provide their own implementations.

Shipped implementations are grouped by the port they implement:

- Identity: Memory and versioned SQLite catalog adapters;
- Config: Memory and versioned SQLite document adapters;
- Session: Memory and versioned SQLite navigation/compaction/query/metadata adapters with durable recent-activity ordering;
- Request: Memory OutputSink plus Memory and SQLite Request Journals;
- Observability: bounded Memory trace storage.

Each SQLite family owns its own options, validation, schema, migrations, SQL, and failure mapping.
There is intentionally no shared SQLite superclass or universal adapter interface. Constructors
accept an optional `tablePrefix` and typed exact `tableNames` overrides; defaults use neutral
`agent_` names. SQLite paths are explicit and reject symbolic links.

```ts
import { SqliteSessionAdapter } from '@ta-agent/base-local-adapters';

const session = new SqliteSessionAdapter({
  databasePath: '/explicit/application/data/agent.sqlite',
  tablePrefix: 'product_',
  tableNames: { sessions: 'conversations' },
});
```

The package is intentionally bounded to local adapters. Remote services, product-owned persistence,
Pi-backed execution, and Standalone-owned namespace lifecycle implementations belong in their own
integration or application packages.
