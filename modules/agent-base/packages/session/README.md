# `@ta-agent/base-session`

Generic Session, append-only lineage, navigation, context-projection, and compaction ports for Agent
Base.

The package defines Session ports and domain behavior without selecting a concrete persistence
implementation. Official process-local Memory and durable SQLite implementations live in
`@ta-agent/base-local-adapters`.

`sessionId` is the sole immutable, opaque Session identity. Adapters allocate fresh IDs and must
never reassign them, including after deletion or reconstruction. Official adapters default to UUIDs;
custom generators may use other reliable IDs within the validated bounded string format. `title`
is the existing optional, mutable, non-unique human-readable label; it does not select identity.

`resolve({ agentId })` creates a new Session. Supplying `sessionId` only opens an existing
Session owned by that Agent; an unknown ID returns `SESSION_NOT_FOUND`, never an implicit creation.
Generated collisions within an adapter's store return `SESSION_ID_CONFLICT`, without modifying or
returning the existing Session. A custom generator is responsible for avoiding reuse across deleted
records or independent stores; the framework does not maintain a global ID registry or tombstones.

Session Lifecycle has separate query, retire/restore, optional purge, execution-fence and recovery
contracts with pure validation/authority helpers. See [lifecycle contract](docs/lifecycle.md) for
state, CAS, busy, stale-reference and cleanup semantics. Official local adapters implement these
capabilities, and runtime Workflows propagate execution leases. No Agent/Workflow management API
is added; lifecycle management remains a separate capability.

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
Both also implement the optional `SessionPresentationPort`. It supplies an exact bounded
`readTurnPresentation({ agentId, sessionId, turnId })` lookup and an atomic
`completeTurnWithPresentation()` operation on the same adapter. A `SessionTurnPresentation` contains
an ordered `reasoningBlocks` array of named `SessionReasoningBlock` values, each containing
`modelTurnIndex` and readable `text`. Indices are positive, strictly increasing model invocation
ordinals within the Session turn; omitted/filtered reasoning can leave gaps. No provider signatures,
model-input meaning, or arbitrary JSON extension bag is accepted. The record includes its original branch identity and survives branch selection,
rewind, and compaction without being copied or reparented.

Presentation is absent from ordinary snapshots, turn-ledger queries, history, and context projection.
Consumers explicitly query the display record; a missing turn or absent presentation returns
`undefined`. Empty records are invalid. `MAX_SESSION_PRESENTATION_CHARACTERS` bounds one record to
64,000 UTF-16 code units across all blocks; `MAX_SESSION_PRESENTATION_BLOCKS` limits structural
overhead to 1,024 nonempty blocks. Validation returns deeply detached frozen values and rejects extra fields and
accessors. Malformed inputs use `SESSION_PRESENTATION_INVALID`; overflow uses
`SESSION_PRESENTATION_LIMIT_EXCEEDED`; corrupt stored records use `SESSION_RECORD_INVALID`.
Domain ports select no default retention policy. The official composition selects capture Steps,
while a custom Session adapter may omit this entire capability when capture is disabled.

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

`SessionCompactionPolicy.timeoutMilliseconds` is an optional cooperative boundary expressed as a
positive integer or `NO_SESSION_COMPACTION_TIMEOUT`. The standard policy defaults to no automatic
deadline. When configured, compaction maps only the deadline it owns to
`SESSION_COMPACTION_TIMEOUT`; parent cancellation remains `SESSION_COMPACTION_CANCELLED`, and a
narrower Actor deadline remains `ACTOR_INVOCATION_TIMEOUT`. This policy does not replace an Actor's
independent invocation policy and does not impose a timeout on Session persistence Steps.

This durable profile intentionally retains a bounded navigation surface. Branch merge, rename,
delete, pruning, retention, cross-Session clone, backup policy, encryption, automatic compaction
scheduling, and distributed coordination remain separate capabilities. SQLite executions stay busy
across restart; opening a database never rewrites active turns. Explicit recovery revokes credentials
and fails interrupted work. A runtime using Request Journal must use the local adapter profile's
coordinated `maintenance` capability to reconcile both domains before reopening admission; Session
recovery alone does not certify Journal recovery.

The core contract remains storage-agnostic. Future file, product-database, or Pi Session adapters can
replace these implementations without exposing their types to request or workflow logic.
