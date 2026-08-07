# `@ta-agent/base-session`

Generic session and turn state ports for Agent Base.

The package provides two adapters behind the same `SessionPort`:

- `MemorySessionAdapter` is the process-local development default;
- `SqliteSessionAdapter` is an opt-in durable local profile using Node 24's built-in SQLite runtime.

The SQLite adapter requires an explicit database path and owns namespaced, versioned Agent Base
tables. It atomically begins and terminates turns, keeps history isolated by Agent/session identity,
and can be reopened by a new adapter or assembled Agent instance. It does not derive storage paths,
persist Pi internals, or automatically guess which active turns were interrupted.

```ts
import { createPiFauxAgentBase } from '@ta-agent/base-agent';
import { SqliteSessionAdapter } from '@ta-agent/base-session';

const session = new SqliteSessionAdapter({
  databasePath: '/explicit/application/data/agent-session.sqlite',
});
const agent = createPiFauxAgentBase({
  identity: { id: 'assistant' },
  session,
  pi: { responses: [{ status: 'success', text: 'Ready.' }] },
});
```

This first durable profile intentionally has bounded linear-turn semantics. Request replay,
navigation, compaction, backup policy, encryption, and multi-process execution ownership remain
separate capabilities. A caller recovering from a known process interruption must identify the exact
active Turn ID and call `failTurn`; merely opening the database never rewrites active turns.

The core contract remains storage-agnostic. Future file, product-database, or Pi Session adapters can
replace these implementations without exposing their types to request or workflow logic.
