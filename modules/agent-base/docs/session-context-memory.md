# Optional runtime Context Memory

Context Memory is a small, fully rendered document supplied to a sessionful Agent. It is not the
conversation transcript, Session compaction, Retrieval Memory, or an implicit system instruction.
Installation is optional. Management-only Memory configuration does **not** enable runtime Memory.
Sessionless/direct-completion Workflows are unchanged.

## Ownership

```text
Host → caller-owned Setup/Profile → declared resource factories
  ├─ raw Agent → Request Workflow → loadContextMemory → request-scoped tools
  └─ management/navigation/recovery → SessionContextMemoryCoordinator
          ├─ Session: branch bindings, Turn references, intents, coordination receipts
          └─ Context Memory: contents, CAS, durable receipts, immutable versions
```

Profiles may use Registry to reuse their root store and counter implementations. Workflows and tools
receive explicit capabilities, never Registry. The raw Agent is still the ordinary Agent; it does not
own or close a Memory store. Materialization only consumes prepared ports.

## Standalone Profile installation

```typescript
import { createStandaloneDirectorySetup } from '@ta-agent/base-standalone-agent';
import {
  createAgentRuntimeService,
  createSessionNavigationService,
} from '@ta-agent/base-composition';

const setup = createStandaloneDirectorySetup(
  { rootDirectory, readEnvironmentVariable: (name) => process.env[name] },
  {
    storageNamespaceId: 'my-application', // stable tenancy, not a Config revision
    context: {
      runtime: {
        enabled: (agentId) => agentId === 'researcher', // omitted: all Agents in this setup
        writable: true, // omitted: read-only runtime tools
      },
    },
  }
);

try {
  // The Agent's ordinary Identity/Config must already exist in this Profile.
  const agent = await createAgentRuntimeService(setup.definition).open(agentId);
  const result = await agent.invoke('foreground', { message: 'Remember this decision.' });
  const navigation = createSessionNavigationService(setup.definition);
  const state = await navigation.inspect({ agentId, sessionId: result.sessionId });
  // navigation.fork/rewind use the selected completed Turn's exact checkpoint, not head Memory.
} finally {
  // First cancel/join all business executions that this Host admitted.
  await setup.close();
}
```

Memory and Shared SQLite setups accept the same second argument. Defaults use the existing local
SQLite Memory root and formal text counter. A custom `acquireStore` may remain current-only for
management; enabling runtime requires the explicit `MemoryHistoryStore` capability. No type assertion
upgrades a current-only adapter. Historical rendering resolves the counter declared by the pinned
version, not the current head's counter.

`runtime.writable` authorizes the default write tool. `toolAllowList` supplies an explicit ceiling for
custom tools. Standalone's opt-in runtime policy installs matching Actor, Responsibility, product and
runtime tool permissions; ordinary raw compositions still control their four permission boundaries.
Human/operator management is a separate trusted application capability, not a grant to the model.

## Data and tools

At Turn admission the coordinator fixes `{ memoryId, revision }`, loads that exact complete version,
and prepends a `context` data message. New runtime documents use the JSON renderer so IDs are visible
for edits. No per-model-call refresh, automatic observe, planner, compaction, or Retrieval pre/post-step
is installed. Within a Turn the model receives tool results; the next Turn reloads the full document.

Default tools are:

- `read_context_memory`: current bound document, item IDs and revision; no caller-selected target.
- `apply_context_memory`: deterministic atomic command batch plus `expectedRevision`. No LLM call.

The model-facing default command schema requires `op`, `itemId`, `content`: `add` uses empty `itemId`,
`remove` uses empty `content`, and `replace` supplies the complete replacement. IDs are system-generated.
A custom `createTools(scope)` can change this encoding, names or presentation while consuming only
the narrow bound `read/apply` capability. It must declare its names in the composition's tool ceilings.

Over-budget writes reject; they do not truncate, silently change render configuration or invoke a
compaction model. The document budget includes its renderer/tokenizer, not the entire model request;
the usual Request/provider context limits remain separate.

Each successful tool edit is durable, even if the model answer, Turn completion, cancellation or
output delivery later fails. The Turn records input and final confirmed references. An explicit read
of a newer version can advance its confirmed final reference; an unrelated later head never does.

An explicit native apply Workflow `skipped` result is not a commit or an unknown outcome. The
coordinator settles that invocation as skipped and replays the same result without executing it again
or waiting for a receipt. No Memory revision is created by the skipped invocation.

## Branches and explicit baselines

A branch has its own mutable document. Fork/rewind derives revision 1 from the selected completed
Turn's final checkpoint, including inherited ancestor Turns. Source history/receipts are not copied;
later source changes do not change the target. Select uses the existing branch binding.

Memory fork and Session navigation are different authorities. A durable intent fixes target IDs
before fork. Session navigation, the new binding and its navigation receipt publish in **one Session
transaction**. A half-finished derivation remains pending and blocks Turn admission. Retrying reuses
the same target/request. Memory-unaware navigation rejects a bound Session instead of creating an
unbound branch.

An existing target branch ID is rejected before persisting an intent or deriving Memory. A definite
Session publication rejection is durably settled as rejected, retaining any already committed Memory
fork receipt; it does not indefinitely occupy the Session or roll back that Memory. Storage ambiguity,
cancellation after fork, and unconfirmed cleanup remain fenced for recovery. Recovery reuses a known
fork receipt rather than invoking the derivation again.

For an old Session without a binding, explicitly call:

```typescript
const memory = await setup.sessionContextMemory!.resolve(agentId);
await memory.initialize({ agentId, sessionId, branchId }); // empty baseline from now on
// Or pass an exact source MemoryVersionReference as the second argument.
```

This does not invent checkpoints for old Turns. Branching from a Turn without a settled checkpoint
fails explicitly; there is no latest-head or empty-history fallback.

## Management, recovery and lifecycle

The coordinator exposes `inspect`, idle `apply`, `readCheckpoint`, `initialize` and `recover` without
constructing a chatting Agent or acquiring provider credentials. Idle `apply` updates the bound
document but never rewrites a previous Turn's checkpoint. Active execution/pending coordination
blocks management writes. Archive/restore retain references.

Before a tool write, Session persists the exact original request and input digest. Afterwards its
Memory receipt advances the Turn checkpoint and settles the intent. If association fails, recover
that original receipt, not the latest Memory version; do not rerun the model. Missing receipt is
**unknown**, not proof that nothing committed. Unknown work remains fenced until its outcome is known.
Successful request replay does not initialize, reload or repeat Memory tools.

Intent creation is conditional, never an upsert. Concurrent attempts with the same request identity
arbitrate against the winning original input; different input cannot replace its intent or receipt.
Updates use the caller-captured coordination revision, with exact-result replay for lost responses.

Official Session management recovery uses `recoverSessionWithContextMemory`: first the existing
Session/Journal owner fences and revokes old leases, then Memory intents reconcile, then Session
recovery completes with fresh occupancy CAS. A stale recovery CAS never authorizes Memory repair.
Cancellation is forwarded through this protocol; a known commit is not reclassified as not committed.

`SessionMemoryCommitError.commit` distinguishes a known Memory receipt from unknown outcome.
`SESSION_MEMORY_PENDING`, `SESSION_MEMORY_NOT_CONFIGURED`, `SESSION_MEMORY_CONFLICT`,
`SESSION_MEMORY_INVALID`, and `SESSION_MEMORY_CLEANUP_FAILED` are distinct stable Session errors.
Cleanup is classified across the entire error tree, independently of cancellation and commit.

A cleanup-pending intent cannot be fixed by finding a business receipt. After the **actual resource
owner** confirms cleanup, a trusted operator may acknowledge the exact journal kind/id/revision using
`acknowledgeCleanup`, then resume receipt recovery. This API does not clean resources or authorize a
model to dismiss failures. A poisoned live setup keeps its own failure for `close`; acknowledgement
does not erase its resource owner's failure. Close never reports success while such cleanup is unknown.

The Host must cancel/join its raw Agent business runs before closing Setup. Registry owns acquisition
lifetime, not model execution. The Memory lifetime guard additionally refuses premature release and
retains Workflow cleanup failures; it is not a replacement Agent scheduler.

Session purge deletes Session-owned coordination only after lifecycle checks. It does not claim to
physically erase independent Memory history. Physical Memory purge/orphan GC is not added here.

## Other product compositions and hosts

Agent Web has its own Config and Session composition. It uses
`setup.sessionContextMemory.bind(agentId, declaredSessionPorts)` to bind those explicit ports to the
same Profile-selected Memory authority. This is a composition seam: do not fetch hidden adapters from
another Service or create another Session store. The returned public coordinator includes tracked
runtime `open` and the same management/navigation protocol. No extra Web Memory protocol is required.
`WebMemoryOptions.provisioning.context.runtime` is the opt-in; no UI redesign or new configuration tab
is required.

The CLI's private host-loading composition accepts `StandaloneMemoryManagementOptions` as the third
argument of `loadAgentBaseCliRuntime(locator, environment, memory)`. Its owning handle closes only
after `withCliRuntime` joins execution. This is not a new SDK export or command-line switch; the stock
CLI binary remains default-off. External hosts use the public caller-owned Setup and
`openStandaloneAgent`. Hosts needing Memory-aware navigation retain that same setup and use its
formal navigation Service.

Independent compositions can implement `RequestContextMemory` directly. The default coordinator
consumes only public `ContextMemoryWorkflows` run capabilities and explicit Session ports. Named
Request Step `loadContextMemory`, its executor/Workflow, native Memory Workflow definitions, custom
tool factory and resource implementations remain replaceable. Optional installation never mandates
the default Bundle, Registry, SQLite or Standalone Profile.
