# `@ta-agent/base-session`

Generic Session, append-only lineage, navigation, context-projection, and compaction ports for Agent
Base.

The package defines Session ports and domain behavior without selecting a concrete persistence
implementation. Official process-local Memory and durable SQLite implementations live in
`@ta-agent/base-local-adapters`.

```ts
import { createDeterministicAgentAPI } from '@ta-agent/base-composition';
import { SqliteSessionAdapter } from '@ta-agent/base-local-adapters';

const session = new SqliteSessionAdapter({
  databasePath: '/explicit/application/data/agent-session.sqlite',
  tablePrefix: 'product_',
  tableNames: { sessions: 'conversations' },
});
const agent = createDeterministicAgentAPI({
  identity: { id: 'assistant' },
  session,
  provider: { responses: [{ status: 'success', text: 'Ready.' }] },
});
```

Both official local adapters implement `NavigableCompactableSessionPort`, `SessionQueryPort`, and
`SessionMetadataPort`.
The query port lists recently active Sessions with keyset pagination, inspects bounded summary
metadata, and pages the newest-first durable Turn ledger across all branches and terminal states.
The metadata port renames a Session through an independent revisioned CAS; its stable Session ID and
conversation-activity ordering do not change.
It deliberately omits unbounded Turn and Branch collections from Session inspection. Branch listing
requires a separately bounded query contract when a real consumer needs it. The query ledger is
separate from `loadHistory()`: the latter selects completed model context, whereas the ledger is a
lossless product read primitive.

Every Session starts on the stable `main` branch. Turns record immutable branch and parent-turn
authority, and successful completion alone advances a branch head. `resolve()` captures the selected branch plus a navigation revision;
`beginTurn()` verifies that authority atomically, so a stale request cannot silently attach to a new
selection. One active turn is allowed per branch.

`navigateSession` is a public Agent Operation backed by an ordinary replaceable Workflow with
independently replaceable validation,
inspection, and commit Steps. It supports read-only inspection, selecting an existing branch,
creating an unselected fork at a completed ancestor, and non-destructive rewind. Rewind creates and
selects a child branch; it never moves a source head, reparents a turn, or deletes history.

Raw completed turns remain authoritative through `loadHistory()`. Compactions are isolated per
branch and store a revisioned projection through an exact completed ancestor. `loadContext()` then
returns that branch's context message followed by its completed raw tail. CAS prevents stale
compactions from replacing a newer revision, and no compaction deletes or rewrites a turn. A child
inherits a source projection only when its boundary remains an ancestor of the branch point.

`compactSession` is a public Agent Operation backed by an ordinary replaceable Workflow. Its
composite Step resolves the registered
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
