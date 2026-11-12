# Consuming the shared Agent workspace

## Choose the level of reuse

Use `@print-an-agent/ui-react` for individual controlled components. Use `@print-an-agent/ui-workspace` for the
complete application experience: Agent catalog/profile, Session selection/lifecycle/navigation,
concurrent interactions, drafts, Session admission, cancellation, history reconciliation, navigation
guards and default layout. `agent-web` uses this same implementation; it is not a controller template
that consumers copy. All packages remain independent of Agent Base and of product runtimes.

```tsx
import { AgentWorkspace } from '@print-an-agent/ui-workspace';
import type { WorkspacePorts } from '@print-an-agent/ui-contracts';
import '@print-an-agent/ui-styles/default.css';

export function Product({ ports }: { readonly ports: WorkspacePorts }) {
  return <AgentWorkspace ports={ports} profileLabel="Research workspace" />;
}
```

`BrowserAgentWorkspace` adds the standard hash routing. `AgentWorkspace` also accepts controlled
location callbacks for host routers. `CollectionApplication` combines the standard routes, reference
resolution, leave protection and immutable connection binding. A `CollectionConnection` contains
`ports`, a display label and an optional extension. A reference can be `{ tenant, notebook }`, a
string handle or other non-secret JSON. A resolver returns a canonical key; JSON serialization is
not identity and the URL never serves as permission. Scope/backend resource lifetime belongs to
the host. Recent-history coordination is reusable; browser persistence is separately replaceable.

## Required and optional capabilities

| Surface      | Required                               | Optional                                        |
| ------------ | -------------------------------------- | ----------------------------------------------- |
| Agent        | `listAgentPage`, `inspectAgentDetails` | rename, disable, reactivate                     |
| Session      | list, inspect, inspect navigation      | rename, retire, restore, purge, select branch   |
| Conversation | history, interaction stream            | fork, rewind                                    |
| Product      | none                                   | creation, settings, Inspector, readiness notice |

Omit unsupported functions; do not install stubs that always fail. Missing capabilities remove their
actions. No generic Agent hard-delete, arbitrary JSON config editor or provider registry is added.
Revisions are opaque and independent: identity, Session metadata/navigation and every product
settings authority must retain their own revision.

Agent pagination is included in the shared controller and optional transport. `nextCursor` is opaque;
the controller loads pages, suppresses duplicates, guards repeated cursors and retains deep-linked
selection outside loaded pages. A single-page backend omits the cursor. Default Agent Web currently
has a genuine single-page Agent Base source; a paginated product must implement pages rather than
load all Agents behind a facade. Session/history cursors retain their existing paginated semantics.

## Typed product extensions and independent commits

Pass a stable `WorkspaceExtension` component. It receives selected Agent details, `refresh`,
`onCreated`, `onRemoved` and a child render function. Call `children({ settings, inspector, createDialog,
requestCreate, boundary, interaction })` with only the surfaces you provide. Config data stays in
the product's types and codecs. Shared controllers never inspect product config.

Use one `useRevisionedEditor<Value>` per commit authority:

```ts
const preferences = useRevisionedEditor<ResearchPreferences>({
  scope: `${collectionKey}/${agentId}/preferences`,
  read: (signal) => services.readPreferences(agentId, signal),
  save: (snapshot, signal) => services.savePreferences(agentId, snapshot, signal),
  equals: equalPreferences,
});
const boundary = useWorkspaceBoundary([preferences.boundary, compute.boundary]);
```

Each instance owns its draft, revision, reads, mutation and errors. Save/reload do not erase edits
made after submission. `scope` changes abort obsolete work and suppress its results; cancellation
does not prove rollback. Render the product's validation fields and result notices in its section.
Do not merge two independently committed settings blocks into one revision or save button.

For creation or commands, `useWorkspaceMutation<Input, Value>` supplies the same scoped single-flight
ownership without assuming an editor. Handle outcomes explicitly:

- `committed`: accept the returned durable value. `notices` can report preparation/indexing/refresh
  failure. Creation calls `onCreated` once; do not retry creation because later preparation failed.
- `rejected`: the adapter knows the durable mutation did not commit. Render safe validation/conflict
  feedback. Reload authoritative revisions before retrying conflicts.
- `indeterminate`: transport or another failure obscured the outcome. The helper blocks resubmission
  until an authoritative reconciliation; `reconciled()` is not a retry shortcut. Thrown exceptions
  become a safe indeterminate result, not a claim of rollback.

An extension reports dirty/working state and an opaque `editIdentity` that changes with each unsaved
edit snapshot. `useWorkspaceBoundary` combines explicit participants, without a registry. Collection
navigation refuses active work and rechecks the authorised edit snapshot after asynchronous opening;
edits made during the wait are protected. Workspace navigation blocks pending extension work by
default. Override `navigationBlocked` only if the product retains that work safely across selection.
The extension component and ports should have stable identities; inline redefinition remounts state.

### Confirmed Agent removal

Call `onRemoved(agentId)` only after the product confirms that an Agent is no longer an operable
member of this Collection. This is a result notification, not a deletion command or generic
retirement policy. The product owns confirmation, the mutation and any authoritative reconciliation:

```ts
// Both a successful product mutation and reconciliation of an uncertain outcome use this path.
if (authoritativeResult.agentRemoved) onRemoved(agentId);
```

The workspace invalidates that Agent's in-flight queries, mutations and interaction delivery and
clears its cached conversation state and drafts. If selected, it also clears Agent/Session selection,
replaces the current route with an unselected conversation view and closes its Inspector and
navigation confirmation. This confirmed fact is not blocked by the removed Agent's unsaved-edit
guard. Other Agents' selections, drafts, settings and background interactions remain intact; only
the Agent catalog is refreshed, without reloading the current unrelated Agent.

Repeated notifications are safe. A removed ID is excluded from stale catalog pages and navigation
within this mounted workspace; `refresh()` does not revive it or automatically select a replacement.
An explicit `onCreated(id)` can acknowledge a newly created identity using that ID. Read failures,
missing records in a page and the ordinary `disabled` lifecycle never imply removal.

Notifications are scoped to the mounted Collection. `CollectionApplication` keys workspaces by the
canonical Collection key. Hosts mounting `AgentWorkspace` directly must likewise mount a fresh keyed
instance when changing Collection. A callback retained after unmount is ignored, even when the new
Collection has the same Agent ID. Extensions must scope their own editors and operations by Agent
and Collection and handle `agent === undefined`; the workspace does not manage product resources.
Cancellation requests cooperation and suppresses stale UI results; it does not roll back commits
or claim to stop non-cooperative backend work.

Interaction ownership outlives streamed `failed`/`cancelled` presentation events: the conversation
target stays single-flight until `streamInteraction()` settles. Draft admission transfers the same
ownership to the canonical Session/branch target. Removal invalidates all of that Agent's target
owners, including streams still cleaning up after a terminal event. Other targets remain concurrent.

## Interaction and presentation authority

An application extension may provide optional `headerActions` React content for independent features,
such as Agent Web's temporary conversation modal. Workspace only places this content in its header;
the extension owns state, ports, cancellation and Collection-scoped cleanup. Do not reuse persisted
conversation identity, receipts or controllers for features without those semantics. Public
Conversation primitives can still render independent transcripts. The optional default stylesheet's
`ta-ui-conversation-drawer` class gives a Drawer a bounded scrolling transcript with a reachable footer.

Stream order is `interaction-started`, authoritative `session-admitted`, presentation events, one
terminal event, then successful port settlement. Session identity exists before model output; never
wait for a first token to admit it. Model-turn indices preserve reasoning boundaries. Tool events
contain only approved display labels/details, not raw arguments/results or diagnostic evidence.

An idempotent replay targeting an existing Session may omit `session-admitted`: its terminal
Session/branch identity must match the original request. A `committed` receipt for a new Session
still requires authoritative admission; a receipt alone cannot establish a new navigation target.

`completed` contains the exact durable completed Turn and must agree with accepted streamed content.
If execution committed but canonical presentation is slow/unavailable, terminate promptly with
`committed` and its exact `{sessionId, branchId, turnId}` receipt and safe recovery message. Do not
keep the interaction promise pending indefinitely on presentation queries, fabricate a completed
Turn, or report model failure after a known commit. The workspace ends busy state, retains partial
display and offers `Reload saved response`. History may load or fail independently. Matching saved
history replaces the receipt, preserving manual reasoning expansion. The recovery action queries
history; it never resends the model request.

Default Agent Web bounds its post-commit presentation wait to one second (host override:
`WebBackendOptions.presentationWaitMilliseconds`). The budget covers the entire chain, including
Session port acquisition, snapshot inspection and presentation reads. The app's standard
`beginRequest` uses the Run ID as the Turn ID; a replay response retains the original Request ID.
Together with successful invocation, this establishes the exact receipt before display queries.
This mapping belongs to that composition, not a general assumption made by `ui-workspace`.
This is a read-only UI projection budget, not a model deadline. The current Session read API cannot
cancel its underlying I/O; the host stops waiting and returns the verified receipt. A late read
result cannot emit another terminal event.

Both durable outcomes remain provisional until the complete stream validates and settles. Late
events or a rejection after `completed`/`committed` invalidate the stream. A transport failure can
still obscure a durable backend commit: reconcile history, not automatic resubmission.

## Optional transport and backend wiring

`@print-an-agent/ui-transport/browser` offers `createHttpWorkspacePorts({baseUrl, capabilities})`.
Explicit capabilities can come from host composition or a decoded host advertisement; omission
does not imply support. They are display capability information, never security authorization.
The root exports common codecs/commands; `/node` exports `readJsonRequest`,
`dispatchWorkspaceCommand`, `writeJsonResponse` and `writeInteractionResponse`.

The host still owns routes, identity/authentication, Collection binding, disconnect cancellation,
resource drainage and safe errors. It must destroy a started HTTP response when stream writing
rejects, rather than ending it as successful. Helpers validate records and sizes, preserve
backpressure and wait for clean EOF before publishing terminal results. Product commands may use
the low-level `createHttpTransport` with their own codecs; they do not extend the shared vocabulary.
Direct Application Services adapters are equally valid and do not need this package.

## Qualification and handoff

The structurally different [research consumer](../packages/workspace/test/qualification/second-consumer.test.tsx)
imports only public packages. It has tenant/notebook references, real Agent pagination, two distinct
typed settings authorities, absent lifecycle/model/branch capabilities, committed creation with
preparation failure, committed settings with coordination failure, concurrent admitted Sessions,
pending history recovery and edits during an authorised Collection switch. It does not copy the
workspace's controllers or import the default Agent Web application.

`@print-an-agent/ui-workspace/testing` exports common qualification entry points:

- `qualifyWorkspaceCatalog(ports)`: follows real cursors and checks unique, independently inspectable
  identities. It is read-only and bounded by a configurable maximum page count.
- `qualifyWorkspaceInteraction(ports, request)`: executes a real request through the same protocol
  validator as the UI. Run against disposable test resources; assert the returned canonical
  completed Turn or durable receipt against the backend's authority. It never retries.

Run the common qualification and default consumer regression together:

```sh
pnpm test:agent-ui-qualification
```

Each backend must provide truthful model-turn IDs, early Session admission,
exact Turn correlation, causal branch lineage/pagination and safe diagnostics. These are adapter/
Application Services responsibilities, not UI guesses. Missing tool presentation may be omitted;
do not infer it from traces. Direct service wiring must preserve cancellation, mutual exclusion,
durable commit semantics, cleanup and safe projection. Its backend/config adaptation is intentionally
not implemented by Agent UI. Remote authentication, durable reconnect, compaction and product-only
operations remain outside this shared workspace's current promises.
