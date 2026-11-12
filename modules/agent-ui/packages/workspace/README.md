# Agent Workspace

`AgentWorkspace` owns the complete shared Agent/Session/conversation UI and controllers. It accepts
`WorkspacePorts` and an optional `WorkspaceExtension`, not a provider configuration or domain runtime.
`BrowserAgentWorkspace` adds the supplied hash-route convention; controlled location props allow
embedding the workspace in a host router. `CollectionApplication` binds a fresh workspace to each
immutable connection. Collection references remain host-defined JSON.

Applications import `@print-an-agent/ui-styles/default.css` explicitly. This package never imports CSS.
Missing optional mutations hide their UI. Agent pagination accepts opaque cursors and retains a
selection outside loaded pages. The default Agent Base adapter is honestly single-page until its
public management service provides pagination.

An extension renders creation, settings and Inspector surfaces through its child render function.
It reports edit identity, pending work and discard behavior. Collection navigation always protects
pending work. Within the workspace pending work blocks navigation by default; an owner that safely
retains operations across selection may explicitly override that policy. No global plugin registry
or application store is exposed. The `testing` entry contains qualification helpers, not a second
workarea implementation to copy into consuming applications.

Extensions call `onRemoved(agentId)` for confirmed removal from the current Collection, not to
execute deletion. The workspace invalidates only that Agent's work and caches, refreshes the
catalog, and clears its selection/route if selected. It stays unselected until explicit navigation
or creation; other Agents' drafts and background interactions survive. Repeated notifications and
callbacks from an unmounted Collection are harmless. Neither read failure nor `disabled` implies
removal. See [the consumption guide](../../docs/workspace-consumption.md#confirmed-agent-removal)
for authority, routing and product-owned cleanup boundaries.

## Independent product commits

Use `useRevisionedEditor` once per revision authority (for example preferences and provisioning).
Each editor owns its read, draft, revision, pending state and outcome. `useWorkspaceBoundary`
combines their navigation protection without combining revisions. Edits made during a save or
reload survive its result. Include Collection, Agent and section identity in each editor scope.

`useWorkspaceMutation` also supports creation and non-editor operations. A `committed` result owns
the durable result even when later preparation/coordination failed; safe notices explain recovery.
`rejected` means known not committed. A thrown/unknown result becomes `indeterminate`, blocking
resubmission until an authoritative read and explicit reconciliation. Cancellation is cooperative,
not a rollback claim. Extensions render their own notices and field validation, and must report
dirty/working boundaries. Scope changes suppress stale UI results, not backend side effects.

Conversation streams can terminate with `committed` plus an exact Session/branch/Turn receipt when
the durable response is saved but presentation is unavailable. This settles execution, retains
partial display and provides history recovery; it never creates a fabricated completed Turn or
automatically resends. Completed/committed outcomes are accepted only after the entire stream
passes validation. History loading/failure does not hide current output or keep execution busy.
