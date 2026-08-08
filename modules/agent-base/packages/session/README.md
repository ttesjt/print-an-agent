# `@ta-agent/base-session`

Generic Session, turn, context-projection, and compaction ports for Agent Base.

The package provides two adapters behind the same `SessionPort`:

- `MemorySessionAdapter` is the process-local development default;
- `SqliteSessionAdapter` is an opt-in durable local profile using Node 24's built-in SQLite runtime.

The SQLite adapter requires an explicit database path and owns namespaced, versioned Agent Base
tables. It atomically begins and terminates turns, keeps history isolated by Agent/session identity,
can migrate its Session schema, and can be reopened by a new adapter or assembled Agent instance. It
does not derive storage paths, persist Pi internals, or automatically guess which active turns were
interrupted.

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

Both adapters implement `CompactableSessionPort`. Raw completed turns remain authoritative through
`loadHistory()`. A successful compaction stores one revisioned projection through an exact completed
Turn ID; `loadContext()` then returns that context message followed by the completed raw tail. CAS
prevents stale compactions from replacing a newer revision, and no compaction deletes or rewrites a
turn.

`compactSession` is an ordinary replaceable Workflow. Its composite Step resolves the registered
`inspectSession`, `selectCompactionSource`, `buildCompactedContext`, and `persistCompaction` leaf
Steps. The default Condition is replaceable, raw leaf definitions fail fast, and the official
assembled Agent supplies concrete overrides. The Workflow is invoked explicitly and is never hidden
inside foreground response production.

This durable profile intentionally retains bounded linear-turn semantics. Request replay, branching,
fork/rewind navigation, backup policy, encryption, automatic scheduling, and multi-process
compaction ownership remain separate capabilities. A caller recovering from a known process
interruption must identify the exact active Turn ID and call `failTurn`; merely opening the database
never rewrites active turns.

The core contract remains storage-agnostic. Future file, product-database, or Pi Session adapters can
replace these implementations without exposing their types to request or workflow logic.
