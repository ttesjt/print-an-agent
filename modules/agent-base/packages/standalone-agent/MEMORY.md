# Optional Memory management

Memory management is separate from a chat runtime. A disabled Agent can still be managed. Reading
does not create a document/space. Enabling management does not inject prompts, install tools,
run post-turn observation, or alter Session lifecycle.

## Implementation ownership

`src/agent-memory/index.ts` is the internal integration entry used by all three profiles.
`extend-setup.ts` composes capabilities over the original canonical Definition; it does not replace
its authority or raw Agent materializer. `options.ts` snapshots host options. `allocation-owner.ts`
owns one Resource Scope per published allocation, validates allocation identity on resolution, and
joins Scope cleanup with the original Profile's `close()`. Repeated close keeps its original result
while forwarding drain-to-abort escalation; busy runtime use leaves resources owned and open.

`provisioning/recipe.ts` declares lazy root acquisitions. `context/resources.ts` separates state-only
and measured selection; `retrieval/resources.ts` separates state, indexed and writable selection.
Their sibling `provisioning.ts` files bind those resources to domain operations. State/receipt/replay
paths do not resolve counters or model capabilities; Retrieval search does not resolve a chunker.
`runtime/extend-definition.ts` installs Runtime/Session capabilities only when explicitly enabled;
`runtime/lifetime.ts` tracks borrowed business use independently of acquisition initialization.
Pure integration contracts live in the owning `types.ts` or `types/` scope.

## Caller-owned setup

All three setup factories accept an optional second argument:

```ts
import { createStandaloneDirectorySetup } from '@print-an-agent/base-standalone-agent';
import { createContextMemoryManagementService } from '@print-an-agent/base-composition';

const setup = createStandaloneDirectorySetup(
  { rootDirectory, readEnvironmentVariable: () => undefined },
  { storageNamespaceId: 'my-application', context: {} }
);
try {
  // Create/manage the Agent through its existing AgentManagementService as usual.
  const memory = createContextMemoryManagementService(setup.definition);
  await memory.create({ agentId, memoryId: 'main', requestId: 'create-main' });
  const current = await memory.inspect({ agentId, memoryId: 'main' });
  await memory.apply({
    agentId,
    memoryId: 'main',
    requestId: 'edit-1',
    expectedRevision: current.value!.revision,
    commands: [{ op: 'add', content: 'A short note.' }],
  });
  await memory.readContext({ agentId, memoryId: 'main' });
} finally {
  // Stop admission and await/cancel ALL business calls before closing their borrowed resources.
  await setup.close({ mode: 'drain' });
}
```

`context` and `retrieval` are independent opt-ins; both default to absent. The Context Service supports
`inspect`, `create`, `apply`, `configure`, `readContext`, and `getReceipt`. `inspect` returns the persisted
Snapshot without measuring/rendering. The default measured operations use the exact bundled
`o200k_base` text counter; `acquireCounter(ref, signal)` and document defaults can select another
formal counter. State/receipt operations never initialize a counter. `apply` and `configure` never
invoke a generative model or compact.

Results have `{ target: { agentId, memoryId }, value }`. The target is the public logical reference;
value retains native domain IDs and receipt digests. Workflow skips are not fabricated successes.

## Stable authority and storage

`storageNamespaceId` is explicit stable tenancy. Keep it unchanged across reopen, Config updates,
runtime reconstruction and directory moves. Native IDs are JSON tuples of that identifier, Agent
ID and logical Memory ID; full encoded length and Unicode are validated, never truncated. Multiple
documents/spaces share an Agent's resources.

- Directory: dedicated `context-memory.sqlite` / `retrieval-memory.sqlite` in each published Agent
  directory. Existing Base root-directory preparation is unchanged.
- Shared SQLite: dedicated `<databasePath>.context-memory.sqlite` /
  `<databasePath>.retrieval-memory.sqlite` sidecars, not Base's table naming configuration.
- Ephemeral Memory: separate `:memory:` SQLite stores/workers per opaque namespace allocation,
  not merely Agent ID. Stale handles cannot resolve a new allocation's resources.

No Memory acquisition happens before publication. Staged abort remains with the original Profile;
it must not close an already-published Memory Scope.

## Provisioning, customization and cleanup

Each optional Definition section has named typed operation factories. A factory receives a published
namespace and business input, and returns a bound `{ memoryId, invoke(signal) }` capability. Generic
Services know no Registry Tokens, paths, SQLite, workers or Bundle internals. Direct/non-Registry
factories are supported.

Official Profiles register long-lived root acquisitions. Per-call native Workflows/Bundles borrow
these roots and do not become another runtime or Scope owner. Workflows receive explicit resources,
never Registry access. Replace named Steps/Executors or Workflow definitions through `workflows`.

`acquireStore` / `acquireBackend` may supply another complete domain adapter. A supplied `release`
owns only that acquisition and runs once; omitting release explicitly borrows the root. Such a root
must own its internal dependencies completely, or have an external owner outliving the setup.
Do not borrow hidden adapters from another Service. Configured factory failure has no fallback.
Cancelled initialization waiters exit independently; setup still owns/joins initialization. Cleanup
failure remains recorded and makes close reject.

Both domains' operation resolvers are available in Profile provisioning. Retrieval content/state
factories need only the coherent Backend; indexed factories require installed `acquireEmbedding`
and the requested chunker, without download or main Actor fallback. Search acquires no chunker.
`createRetrievalMemoryManagementService(setup.definition)` exposes `inspect`, `create`, `get`,
`getReceipt`, `list`, `ingest`, `update`, `remove`, `search`, `readContext` and `reindex`. Supply the
Space's explicit `{ embeddingRef, chunkerRef, metricRef }` when creating it. Existing Space.index is
authoritative for subsequent operations; `reindex` rebuilds one Entry under that same configuration,
not an embedding migration. Entry writes use native expectedRevision/requestId contracts.

Retrieval values retain native `completed`/`skipped` query and `committed`/`unchanged`/`skipped`
mutation outcomes, with `sequence`, Entry revision, citations, source and metadata intact.
`inspect`, `get`, `list`, `getReceipt`, `remove` and matching mutation replays need no embedding or
chunker. Missing representation capabilities only prevent new indexed work. Host/UI opt-in is
separate from installing these Services.

## Commit and recovery

Context create/apply/configure and all Retrieval mutations first match a receipt through a state-only domain capability. A matching
request returns its original result without a tokenizer or repeated Workflow side effects. Different
input under the same request ID is rejected. Preflight miss never replaces final domain CAS and
idempotency arbitration. Do not insert defaults or rewrite native IDs/digests when matching receipts.

`MemoryManagementError` exposes a stable summary, logical target, native domain code, safe budget/
revision details and any known commit evidence. Internal causes/stacks and arbitrary native messages
are not transport DTOs. Known receipts survive cancellation and Executor cleanup failures. `unknown`
is not `not-committed`: recover with `getReceipt` and replay the same original request, never a model
rerun. A receipt query cancelled before reading asserts nothing about the original request's commit.

Resource close failure is separate from business commit: neither fake rollback nor successful close
may be inferred from an edit result. Hosts still own authentication/authorization, business admission,
cancellation and join; namespace isolation/Registry do not replace them.

## Direct composition and independent consumers

Registry is a Profile implementation tool, not a dependency of these Services. A consumer can provide
only a published namespace resolver and the optional typed management capability. Each operation
factory maps the public logical reference to its actual authority, then invokes a native Bundle with
explicit borrowed resources. `replay` must map the same identity and use native request matching;
it must not substitute an ordinary inspect or manufacture a receipt. Services do not close factories,
Bundles or their adapters. A direct consumer owns and drains these resources itself.

The public-package-only example
[project Context provisioner](../../tests/integration/test/consumers/direct-context-memory.ts) and
[management consumer tests](../../tests/integration/test/memory-management-consumer.test.ts)
demonstrate direct/non-Registry provisioning, a borrowed adapter wrapper, a named Step and a complete
Workflow graph replacement, real SQLite reopen and exact replay. The same consumer suite exercises
the official Directory Profile with both domains, real vector workers, explicit formal embedding,
lost-delivery recovery without another embedding call, and content-only management after model loss.
No chat runtime or provider credentials are needed for that suite.

See Agent Web's `MEMORY.md` for optional UI/HTTP installation. This management integration does not
turn Memory into an Agent Operation, automatically attach it to Sessions, install tools, or inject
context into a prompt. Those are separate product decisions.
