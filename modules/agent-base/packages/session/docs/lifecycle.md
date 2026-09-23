# Session lifecycle contract

## Capability boundaries

Lifecycle is a management capability, not an Agent execution task. Ports are independent:

| Port                           | Responsibility                                                               |
| ------------------------------ | ---------------------------------------------------------------------------- |
| `SessionQueryPort`             | Existing bounded list, inspection and turn-ledger reads                      |
| `SessionLifecycleQueryPort`    | Lifecycle summaries for lists; lifecycle/fence evidence for exact inspection |
| `SessionLifecyclePort`         | Retire and restore, using metadata CAS                                       |
| `SessionPurgePort`             | Optional atomic Session-aggregate deletion with explicit confirmation        |
| `SessionExecutionPort`         | Session-scoped execution admission and release                               |
| `SessionExecutionRecoveryPort` | Optional explicit reconciliation of interrupted Session-owned execution      |

Consumers request intersections of the capabilities they actually need. Implementing `SessionPort`
does not imply implementing management, purge, or recovery. No port exposes a path, table, SQL
transaction, universal resource registry, or another module's product semantics.

This package owns contracts and pure domain decisions. `base-local-adapters` implements the Memory
and SQLite capabilities. Official runtime Workflows detect `SessionExecutionPort`, acquire a lease,
propagate it through `SessionWriteAuthority.execution`, and release it after settlement. Execution
is optional on generic inputs so custom non-lifecycle ports remain valid; official lifecycle adapters
reject runtime writes without a currently registered lease. Replacement Workflows/Steps must retain
these obligations. A wrapper around an unfenced runtime cannot claim lifecycle safety.

## State and identity

Persisted lifecycle is `active | retired`. Restore returns to active. Purge means record absence;
there is no durable `purged` or `restored` state. A retired record carries `retiredAt`; active records
do not. Ordinary listing excludes retired Sessions. Retired listing orders by `retiredAt DESC`,
then Session ID ascending, with an exclusive cursor and the existing 1–200 query limit (default 50).
Pagination is live keyset pagination, not a frozen snapshot across mutations.

Both active and retired lists return `SessionLifecycleSummary`: bounded Session metadata plus
lifecycle state, without an execution-fence lookup. Exact inspection returns
`SessionLifecycleInspection`, adding current execution-fence evidence. A list entry is not evidence
that a Session is idle; management mutations always check authoritative occupancy at commit time.

Inspection accepts either state; history, context, turn-ledger and presentation reads remain
available. Missing query results return `undefined`; missing mutation targets fail. No automatic
restore on `resolve`, `beginTurn`, compaction, navigation, or replay.

`sessionId` is the sole opaque, immutable Session identity, allocated by its adapter and never
reused. Omitting an ID creates a Session; supplying one opens only that existing Session or fails
with `SESSION_NOT_FOUND`. Official adapters default to UUIDs, without making UUID format a domain
requirement. Custom generators must reliably avoid reuse, including across deletion and restart.
No tombstone collection or global ID registry is required. `title` is the existing mutable,
non-unique human-readable label, never an identity or lookup substitute.

Management mutations bind `(agentId, sessionId, expectedRevision)`. The revision is the **existing
metadataRevision**, shared with rename. Renaming a retired Session remains allowed and does not
alter retirement ordering. Restore preserves the Session ID; creating another Session after purge
always allocates a different ID. Any write targeting a deleted Session fails with `SESSION_NOT_FOUND`.

## Execution fence

An execution lease binds `(agentId, sessionId, executionId)`. The adapter issues and
registers it; parsing a well-formed value does not grant authority. Execution IDs are not reused
within a Session, even after release/recovery. Every protected write checks the currently registered
credential and lifecycle state **atomically with its commit**. A preflight-only check is insufficient.

Session identity, metadata CAS, and execution ownership are distinct. Rename does not invalidate a
valid lease. Restore does not revive a released or revoked lease. Execution credentials identify an
authorized operation, not another Session identity.

Execution occupancy covers:

```text
execution admission
  → Session/Journal claim and normal execution OR completed-response replay
  → Session/Journal settlement and OutputSink close/fail cleanup
  → execution release
```

Compaction and navigation writes also participate. Ordinary reads do not acquire a lease. Admission
may allow multiple independent leases; existing per-branch Turn constraints still apply. This is
not a new Session-wide exclusive lock.

The adapter's `SessionExecutionFence` is bounded inspection evidence, not caller authority. Busy
means **any** active lease, unsettled Session-owned work, or Session recovery in progress.
`pendingWorkCount` counts Session-owned work, not another domain's records. Request orchestration
retains its Session lease through Journal and output finalization; this does not make the Session
adapter responsible for inspecting either resource.
Releasing a lease must not conceal orphaned work. `revision` advances on every occupancy/recovery
change; it is separate from metadata CAS. Counter exhaustion fails closed, never wraps or resets
within a Session. Atomic admission vs retirement must permit only one result: admission wins
and retirement is busy, or retirement wins and execution is rejected.

## Explicit recovery

No lease expiry, timeout unlock, database-open repair, or inference that a long-running request is
dead. A durable adapter retains occupancy across restart. An authorized operator explicitly asserts
that recovery is appropriate; the capability is not a forced cancellation mechanism.

Recovery checks the Session reference and `expectedExecutionRevision`, then serializes recovery ownership,
blocks admissions/writes, and revokes old credentials **before** reconciling interrupted Session-owned
work. Only after that work is settled may it publish ready/idle Session evidence. This port does not
inspect, recover or certify another domain's state.
Partial failure returns `SESSION_RECOVERY_FAILED` and leaves recovery/busy evidence. Explicit retry
uses fresh inspection and must not compete with a currently owned recovery. Retrying must also
resume durable partial progress; no elapsed-time policy is implied.

Old completions, failures, presentation commits, navigation and compaction writes must fail after
revocation. Release of an unknown, released or revoked lease returns `SESSION_EXECUTION_STALE`.
Memory has no cross-restart recovery requirement, but follows the same live-process fencing rules.
Neither fencing nor recovery can undo arbitrary engine/tool external side effects or take back bytes
already delivered by an OutputSink. Operators must not assume recovery provides exactly-once work.

### Cross-domain recovery ownership

`base-request` owns Request Journal recovery semantics. A managed profile that uses both Session and
Journal must coordinate their recovery through a separately composed capability. Session recovery
alone does not certify that profile as recovered. The coordinator must keep runtime and management
admission fenced throughout the combined recovery, invalidate the respective domain credentials,
and settle both domains before releasing the combined fence. A partial failure must remain blocked.
Sequentially calling recovery methods that each reopen admission is not sufficient.

The local adapter factories `createMemorySessionPersistence` and `createSqliteSessionPersistence`
provide that coordinated capability as `maintenance`; it is not part of this domain package.
Its `purgeSessionPersistence` and `recoverSessionPersistence` methods explicitly identify the broader
cleanup scope and do not implement the Session-only domain ports.
The Memory profile serializes both domains through one private queue. SQLite holds one write lock,
revokes credentials, and reconciles both domains in a savepoint. A reconciliation failure rolls back
that work while committing revoked credentials and recovering state. Completed Turns and Journal
responses survive recovery unchanged; active records become interrupted failures. No response is
reconstructed from a completed Turn, and no model/tool invocation is retried.

## Purge and errors

Purge requires `confirmation: 'permanently-delete-session'`, the exact Session, matching metadata
revision, retired state and an idle fence. The literal makes intent explicit; it is not authentication
or permission. Authorization belongs to the calling application.

The atomic cleanup scope of `SessionPurgePort` is the Session aggregate (turns, branches, compaction,
navigation, presentation and Session-owned execution state). It does not include Request Journal,
traces, attachments, product memory, other Sessions or arbitrary registered resources. One adapter
call gives atomic visibility within that scope. Known storage rejection returns `SESSION_PURGE_FAILED`
without partial deletion. Remote transport ambiguity must never be reported as a verified rollback;
atomicity does not imply exactly-once delivery. Retrying after successful deletion returns
`SESSION_NOT_FOUND`; it cannot affect a subsequently created Session with a fresh ID.

Request Journal cleanup belongs to `base-request`. A managed profile promising Session-plus-Journal
purge must expose a separate composed atomic capability, not broaden `SessionPurgePort` or equate
two sequential deletions with atomic cleanup. A SQLite profile may implement that capability using
a composite adapter and one transaction; other stores may use their own atomic mechanism. If the
profile cannot guarantee the complete advertised scope, it must not expose that composite purge.

Management error precedence after input validation:

1. `SESSION_NOT_FOUND` if the supplied Session reference has no matching record under its Agent.
2. `SESSION_METADATA_CONFLICT` for stale revision.
3. `SESSION_ALREADY_RETIRED` / `SESSION_NOT_RETIRED` for wrong state.
4. `SESSION_BUSY` for occupied/unsettled/recovering state.

Admission/write checks first validate the Session reference, then reject `SESSION_RETIRED`, then recovery with
`SESSION_BUSY`, then unregistered/mismatching credentials with `SESSION_EXECUTION_STALE`. Recovery
CAS uses `SESSION_EXECUTION_CONFLICT`. Input errors are `SESSION_LIFECYCLE_INVALID`,
`SESSION_EXECUTION_INVALID`, `SESSION_QUERY_INVALID`, or `SESSION_PURGE_INVALID` as appropriate.

Normalizers accept unknown values, reject extra/accessor/symbol/inherited fields and contradictory
states, and return detached frozen values. Pure guards expect normalized inputs and authoritative
adapter snapshots/fences; they do not perform I/O, acquire locks or attest adapter honesty.

## Integration qualification

The local adapter and composition suites apply shared observable cases to Memory and SQLite:

- Active/retired listings, bounded pagination and tie ordering; inspection/history in both states.
- Retire/restore/CAS; repeated transitions; rename without disrupting execution.
- Purge followed by fresh-ID creation; deleted references, credentials and asynchronous commits fail
  without affecting the newly created Session, even with the same title and revision.
- Atomic retirement vs admission/beginTurn; branch concurrency remains available.
- Busy during normal execution, completed replay, Journal settlement, delayed close/fail, compaction
  and navigation; acquisition/release on every success, rejection and cancellation path.
- All runtime writes fenced, including failure settlement and presentation, not only beginTurn.
- Session-only purge includes presentation and Session-owned execution state; unrelated Sessions
  and other-domain records survive.
- A separately qualified managed composite purge also removes associated Journal records atomically;
  that composite capability is omitted when independent stores cannot guarantee complete cleanup.
- Durable restart busy state, old credential revocation, recovery CAS/concurrent ownership,
  interrupted Session recovery, failed cleanup, and explicit retry. Managed cross-domain recovery
  additionally proves Journal reconciliation and continuous admission fencing across partial failure.
- SQLite-specific rollback fault injection, restart persistence and complete deletion evidence.

Domain unit tests qualify pure decisions, not storage behavior. Storage evidence lives in
`base-local-adapters/test/integration/session-lifecycle.test.ts`; runtime lease/output/replay,
cancellation and suspended maintenance writes are covered in
`base-composition/test/integration/session-lifecycle.test.ts`. Persistent recovery tests reopen
SQLite adapters/connections and inject storage failures; they do not certify remote stores or
exactly-once external side effects. Standalone namespace-based management services remain separate.
