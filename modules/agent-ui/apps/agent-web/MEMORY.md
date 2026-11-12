# Optional Memory management protocol

This is an application-owned feature, separate from `WorkspacePorts`, Agent runtime Operations and
Session lifecycle. It does not install Memory prompts, tools, observation or model-assisted editing.
The optional management panels consume this protocol; they do not own domain resources.

## Optional Agent Web interface

Configured Collection connections discover their capabilities once on open. The Agent header shows
**Memory** only when the Host has installed at least one capability and binding. The dialog's binding
selector chooses a configured logical document/space, not a Session or a scanned database catalog.
Context and Retrieval can be enabled independently. Missing Memory requires explicit creation;
missing Agent, unavailable model and unavailable preview remain separate errors.

- Context supports item add/edit/remove, stored revision/measurement, full-context preview, and a
  separate configuration save for budget, format and separator. Item/config changes are deliberately
  saved separately against their own latest document revision. Configuration never compacts.
- Retrieval supports real cursor pagination, body/metadata/source editing, semantic search, explicit
  profile selection at creation, entry-level reindex and confirmed permanent removal. Profiles are
  Host-advertised recipes; absence disables indexed work, not content reading/removal. Temporarily
  unavailable providers return safe errors without hiding existing content.
- Drafts and in-flight operations participate in shared Workspace navigation protection. Modal and
  binding changes have the same protection. Cancellation requests cooperation and never declares
  rollback. Each editor is isolated by Collection connection, Agent, binding and Entry identity.
- Delivery loss offers **Read receipt**. A missing receipt does not establish failure; **Retry original
  request** retains the exact original request ID and payload. A recovered/known commit is never
  blindly repeated, even if subsequent display reads fail. Read/discard-and-reload recovers display.

The interface uses shared React dialogs, controls and layout, and Workspace revisioned editors,
mutation outcomes and boundaries. There is no second Agent/Session controller or Memory global store.

## Host composition

The existing `createAgentBaseWebPorts` and `createDirectoryCollectionHost` options accept `memory`:

```ts
memory: {
  provisioning: {
    storageNamespaceId: 'my-stable-tenant',
    context: {},
    retrieval: {
      acquireEmbedding: (representationRef, signal) =>
        installedEmbeddings.acquire(representationRef, signal),
    },
  },
  contextBindings: [{ memoryId: 'main', label: 'Context memory' }],
  retrievalBindings: [{ memoryId: 'knowledge', label: 'Knowledge' }],
  embeddings: [{
    embeddingRef: capability.descriptor.representationRef,
    chunkerRef: installedChunker.ref,
    metricRef: COSINE_METRIC_REF, // imported from @print-an-agent/retrieval-memory
    label: 'My installed embedding recipe',
  }],
}
```

Use the actual exported `COSINE_METRIC_REF` rather than guessing its string. Supply formal Model
Invocation capabilities, not the chat Actor. Acquisition/release semantics come from the official
Standalone Profile. Omit either provisioning section to disable that feature; omitting all Memory
options leaves both absent. Bindings are configured entry points, **not a document/space catalog**.
An enabled feature with no bindings explicitly configured defaults to `main`. The embeddings list is
a safe description of configured recipes, not proof that a remote service is currently available.
Existing Space.index remains authoritative; there is no implicit model migration or fallback.

The Web Definition reuses the original Profile's namespace, authority and optional Memory
provisioning. It does not create a second Agent or open databases in browser code.

## Browser feature ports

`connectHttpMemory({ baseUrl }, signal)` in `src/memory/browser.ts` discovers capabilities and returns
only installed `context` and `retrieval` ports. Keep the returned object for that Collection; never
change a shared mutable root underneath it. Each method accepts an explicit `agentId`, logical
`memoryId` and optional operation signal. Context supports inspect/create/apply/configure/readContext/
getReceipt. Retrieval additionally exposes Entry get/list/ingest/update/remove/search/reindex.

Requests POST to `<baseUrl>/memory` using `{ domain, operation, input }`. `domain` is `context`,
`retrieval`, or `capabilities` (`operation: "inspect", input: {}`). The existing fixed and
`/api/collections/<key>` routes use the same dispatch. Request and response codecs are closed,
browser-safe and application-owned; metadata remains arbitrary finite JSON. Long Memory IDs and
opaque native cursors are not constrained by the Workspace's short ID codec. Responses are also
correlated with the requested logical target/request/operation.

- Reads: `succeeded` with logical `target` and native value, `failed` with safe diagnostics, or native
  `skipped`. An absent optional receipt/value is JSON `null`, never a fabricated empty record.
- Mutations use shared `MutationOutcome`: `committed` retains native `committed`/`unchanged` and its
  original receipt; `rejected` is known not committed; `indeterminate` carries logical recovery
  identity. A Workflow `skipped` remains distinct from all three.
- A known commit followed by cleanup/post-processing failure is still `committed`, with a notice.
  A receipt query that already read a durable receipt likewise returns that fact with notices.
- Lost delivery/invalid post-dispatch response is **not** rejection. Keep the original request and
  requestId, read its receipt, and recover by replaying the same confirmed request. Do not blindly
  generate a new ID or rerun model work. A missing receipt while a request is in flight proves nothing.

Inspect and content-only Retrieval operations do not need a callable chat model or embedding.
Missing embedding only blocks new indexed work. Config revision, Entry revision, document revision,
sequence and native receipt digests remain independent; do not merge them into Agent Config writes.

## Ownership and shutdown

The HTTP transport borrows injected ports/Collections unless `closeResources` explicitly delegates
closing to it. The default Node main delegates `collections.close`. An embedded caller may use:

```ts
const backend = createAgentBaseWebPorts(options);
const server = await startLocalAgentWebServer({
  ports: backend,
  closeResources: () => backend.close(),
});
// server.close rejects admission, aborts and joins HTTP business operations, then closes resources.
await server.close();
```

Without that delegation, await `server.close()` and then close the caller-owned backend yourself.
Direct non-HTTP consumers must stop/cancel/join their own business calls before closing setup.
Disconnect cancels only its request; Registry initialization and other callers remain independently
owned. Shutdown waits for cooperative work, closes all Collection backends, retains cleanup errors
and makes repeated callers observe the same result. It does not race and abandon requests, or add a
short embedding/model timeout. Providers must honor their formal cancellation contracts.

Host authentication/authorization and request/body limits remain Host responsibilities. Public
errors expose stable codes, safe budget/revision details and commit notices, not SQL, paths,
environment values, arbitrary provider errors or stacks.

For independent CLI-style consumption use the public `createContextMemoryManagementService` /
`createRetrievalMemoryManagementService` from `@print-an-agent/base-composition` with a caller-owned setup.
No HTTP, UI or Registry dependency is required in the generic Service consumer.
