# `@ta-agent/base-session`

Generic Session, append-only lineage, navigation, context-projection, and compaction ports for Agent
Base.

The package provides two adapters behind the same `SessionPort`:

- `MemorySessionAdapter` is the process-local development default;
- `SqliteSessionAdapter` is an opt-in durable local profile using Node 24's built-in SQLite runtime.

The SQLite adapter requires an explicit database path and owns namespaced, versioned Agent Base
tables. It atomically begins and terminates turns, keeps history isolated by Agent/session/branch
identity, migrates earlier linear Session schemas onto the default branch, and can be reopened by a
new adapter or assembled Agent instance. It does not derive storage paths, persist Pi internals, or
automatically guess which active turns were interrupted.

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

Both adapters implement `NavigableCompactableSessionPort`. Every Session starts on the stable `main`
branch. Turns record immutable branch and parent-turn authority, and successful completion alone
advances a branch head. `resolve()` captures the selected branch plus a navigation revision;
`beginTurn()` verifies that authority atomically, so a stale request cannot silently attach to a new
selection. One active turn is allowed per branch.

`navigateSession` is an ordinary replaceable Workflow with independently replaceable validation,
inspection, and commit Steps. It supports read-only inspection, selecting an existing branch,
creating an unselected fork at a completed ancestor, and non-destructive rewind. Rewind creates and
selects a child branch; it never moves a source head, reparents a turn, or deletes history.

Raw completed turns remain authoritative through `loadHistory()`. Compactions are isolated per
branch and store a revisioned projection through an exact completed ancestor. `loadContext()` then
returns that branch's context message followed by its completed raw tail. CAS prevents stale
compactions from replacing a newer revision, and no compaction deletes or rewrites a turn. A child
inherits a source projection only when its boundary remains an ancestor of the branch point.

`compactSession` is an ordinary replaceable Workflow. Its composite Step resolves the registered
`inspectSession`, `selectCompactionSource`, `buildCompactedContext`, and `persistCompaction` leaf
Steps. The default Condition is replaceable, raw leaf definitions fail fast, and the official
assembled Agent supplies concrete overrides. `buildCompactedContext` resolves the registered
`session-compaction` Responsibility and invokes its selected Actor in direct mode; Session owns no
provider- or Pi-specific runtime contract. The Workflow is invoked explicitly and is never hidden
inside foreground response production.

This durable profile intentionally retains a bounded navigation surface. Branch merge, rename,
delete, pruning, retention, cross-Session clone, backup policy, encryption, automatic compaction
scheduling, and multi-process ownership remain separate capabilities. A caller recovering from a
known process interruption must identify the exact active Turn ID and call `failTurn`; merely opening
the database never rewrites active turns.

The core contract remains storage-agnostic. Future file, product-database, or Pi Session adapters can
replace these implementations without exposing their types to request or workflow logic.
