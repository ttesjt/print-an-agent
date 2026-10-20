# Composing an Agent Web application

```text
Browser public components + optional stylesheet
    → Collection selection / reference resolver
    → immutable application connection binding
    → ui-workspace controllers and narrow UI ports
    → optional ui-transport HTTP commands / ordered NDJSON interaction stream
    → Node application adapter
    → one managed Agent Base Definition per Collection
        → Identity / Config authority
        → Session management and navigation services
        → materialized Agent and foreground Operation

Temporary branch (same authority, different execution path):
Browser-memory controller → app-owned temporary port / NDJSON protocol
    → inspect active Identity + published Config/revision
    → Sessionless Request Service → Actor → generation-streaming Workflow
    → validated output → successful browser-memory history
```

The Node backend factory is app-owned, not a new exported framework package. It can receive any
Actor Engine, explicit tool registry and safe tool labels, plus Memory or directory persistence:

```ts
const ports = createAgentBaseWebPorts({
  readEnvironmentVariable: (name) => process.env[name],
  persistence: { kind: 'directory', rootDirectory: '/absolute/path/to/agents' },
});
const host = await startLocalAgentWebServer({ ports });
// The host owner awaits host.close() during shutdown.
```

The browser receives only safe DTOs. `App` accepts the application's typed `AgentWebPorts`
composition, so another host may replace all adapters. `BrowserAgentWeb` adds URL selection and
the default entry opens a directory Collection before installing scoped localhost ports; it is not
a second domain owner. Default model configuration stays in its typed product extension. Other
applications consume [the shared workspace](../../../docs/workspace-consumption.md), not this app's
source files. No reusable component imports the Node adapter. The
browser's hash contains only a Collection key, view and Agent/Session IDs,
never provider configuration or credentials. Within a Collection, navigation changes selection
without remounting the workspace or cancelling an unrelated persisted conversation. Changing
Collection remounts the workspace under a new immutable connection binding.
An omitted Agent ID selects the current or first available catalog Agent. `view=settings` restores
Profile, while `view=conversation` restores chat. Unknown fields, duplicate IDs and a Session without
an Agent are rejected. Unsaved Profile edits are guarded before applying external location changes;
rejecting navigation restores the previously applied URL without appending history.

The editable config is a closed, typed application schema: per-Agent provider target/capability,
credential reference/environment binding, Actor instructions/generation and execution policy.
It is not an arbitrary JSON editor or executable adapter loader. The host owns the secret resolver
and tool implementations. An explicitly installed custom Engine can be bound by ID in qualification
profiles; it is never a fallback. Config updates affect subsequent materialization, not in-flight calls.

## Temporary response boundary

The optional app-owned `temporaryConversations` port is independent of persisted conversation ports.
`createWebTemporaryConversationPort()` receives only Identity/Config inspection and model-host
resources; it cannot open the managed runtime or provision Session/Journal ports. Each call resolves
one immutable published config snapshot, a borrowed model Engine and a per-call OutputSink through
`createSessionlessRequestService()`. Request deadline covers resource resolution and execution;
Actor and provider liveness policies retain their own error ownership. Defaults impose no deadline.

The frontend pins Agent/config revision. Caller-supplied successful text pairs are serialized as
untrusted context, not reconstructed assistant messages with invented provenance. Reasoning is
display-only and ephemeral. No model/credential configuration is accepted in the temporary payload.
The app validates exact output receipt, IDs and revision; `completed` is provisional until clean EOF
and successful port settlement. A late failure cannot admit a successful history pair.

Fixed hosts expose `/api/temporary-conversations`; Collection hosts use the same route under their
immutable `/api/collections/<key>` binding. Existing origin, body/frame/stream bounds, disconnect
cancellation and shutdown drainage apply. Only neutral NDJSON framing is shared with persisted
transport; Temporary DTOs and protocol policy remain app-owned.

The app installs its modal through the optional Workspace `headerActions` slot, reusing public
Conversation/Composer/reasoning components. The slot does not give Workspace ownership of temporary
state or introduce a generic sessionless domain into reusable UI packages. Changing Collection
unmounts this feature and cancels its owned work. Closing the modal only hides it: the same controller
continues receiving output and records settlement while hidden. Reopening the same target does not
start another request. Explicit cancellation, clear/reset, or unmount still cancel owned execution.

## Reusing components independently

Import structure and behavior from `@ta-agent/ui-react`. Import
`@ta-agent/ui-styles/default.css` separately if desired. Consumers may omit styles entirely, or
override tokens/classes without changing component behavior. Components neither import a theme
nor know the Agent Web port/store/transport shape. The Gallery's separate `consumer.html` entry
demonstrates the same interactive Notes composition with no stylesheet, the default stylesheet,
and an application-owned token override. It is a qualification fixture, not a template generator.

## Runtime and recovery guarantees

- Persisted conversations own independent history, draft, interaction and cancellation state.
  Selection only changes the visible target. Only unsent drafts are disposable; submitted drafts
  own their interaction until settlement, independently of foreground selection.
- `session-admitted` promotes a submitted draft to its authoritative Session before the model
  responds. It preserves interaction ownership and does not declare a successful Turn. Late
  admission/completion does not replace the foreground selection of another draft or Session.
- Revision conflicts reconcile authoritative details and catalogs. Transport failure is projected
  safely with retry; malformed responses never become domain state.
- Awaited stream consumption retains order/backpressure. Success comes from the committed Session
  Turn, not from optimistic UI state. Request replay reconstructs saved reasoning blocks.
- Cancellation is cooperative. If commit I/O has already begun, history reconciliation determines
  the durable result; cancellation does not imply rollback or globally exactly-once draft creation.
- Tool presentation is live safe status/label data. Reopened history does not reconstruct tool
  records because the public Session authority does not persist them.

See [backend boundaries](./backend-boundary.md) and [host deployment limits](./local-host.md).
