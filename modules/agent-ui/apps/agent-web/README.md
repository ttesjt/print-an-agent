# Agent Web

General-purpose Agent Web application composition root.

Thinking panels use the global medium content height limit (18rem by default). They never auto-open
or auto-close: this application does not guess when a provider's reasoning ends. Manual expansion
is conversation-scoped, ephemeral UI state and survives live-to-history and draft-to-persisted
transitions. It is not written to Session data, sent to the model, or restored after a page reload.

This application owns Agent lifecycle, Session management, conversation
interaction, routing, application-wide state, backend transport, and the adapter to an Agent
runtime. Those responsibilities remain application policy and do not flow into reusable UI
packages.

The default browser composition installs validated localhost HTTP/NDJSON ports and imports the
optional default stylesheet explicitly. The Node host connects these ports to public Agent Base
services and an actual Agent, with directory/SQLite or injected Memory persistence. Provider
provisioning and credentials stay on the host. The Agent adapter implements
catalog, inspect, create, CAS display-name updates, configuration revision checks, disable, and reactivate. The Session adapter
implements paginated active/retired catalogs, inspection, rename, retire/restore, optional purge,
and branch selection. The conversation adapter implements paged history, ordered streaming text and
model-turn reasoning, sanitized tool presentation, cancellation, successful Turn commit, and
non-destructive fork/rewind branch mutations. Explicit `?mode=deterministic` selects browser-only
fixtures instead; these have no durable backend. The application contains no component-local CSS.
A product application can replace the
adapters and stylesheet without changing reusable component behavior.

The application consumes one typed composition of narrow Agent, Session, history, interaction, and
branch-mutation ports. This grouping belongs to Agent Web; it is not a universal backend adapter and
does not leak the deterministic implementation into controllers. Agent, Session, and conversation
orchestration live in separate application-owned controllers while `App` remains the composition and
view-wiring boundary.

The composition treats configuration and lifecycle mutations as independent operations. Revision
conflicts reload an authoritative snapshot before retry, structured validation remains attached to
its owning fields, and delayed mutation results cannot replace a newer Agent selection.

Session operations use the same stale-result and revision protections. Switching Agent or Session
cancels obsolete reads and prevents late results from replacing the current workspace. “New” opens
an unsaved conversation draft; persistence begins when the backend admits its first message,
not when the model finishes responding. Metadata and navigation can complete concurrently without overwriting one another;
revision conflicts remain visible until an authoritative reload reconciles both selected details and
the current catalog. A failed Session inspection exposes the same retry/reconciliation path.

“New” immediately publishes an application-owned draft entry and selects the Active catalog.
It does not fabricate a persisted Session ID. Sending immediately shows an ordinary Session row
in the same sidebar list, without a separate "creating" view. An authoritative `session-admitted`
stream event associates the actual Session ID with that same row and promotes the matching
conversation before any model response. The row retains its DOM identity and keyboard focus during
confirmation. Admission is not a successful Turn commit: only a verified successful terminal
stream commits successful UI history. Settlement reconciles the catalog even after failure or
cancellation. Background admission and completion cannot steal a newer selection.

Conversation state is keyed by persisted Agent, Session, and branch identity. Persisted interactions
can continue concurrently while selection changes; each target owns its history cache, Composer
draft, live/partial Turn, cancellation, and error state. Returning to a target restores that state,
and cancelling the selected target does not cancel another target. Each new-conversation draft
has a unique application-owned identity. Unsent drafts remain disposable; submitted interactions
continue independently of selection even before Session admission arrives. Promotion preserves
the same interaction, cancellation ownership, and manual reasoning expansion state.

Each logical send receives a new browser-generated UUID, independent of mounts and tabs. On a
persisted target, it is also the Request Journal idempotency key. Only an explicit retry of that
same interaction may reuse its identity; sending the same text again is a new interaction.

History reads and pagination reconcile with the target's current turns, retaining successful commits
that arrive while a read is pending. Loading and failed history boundaries preserve existing Turn
presentation. Interaction, pagination, and branch mutation slots are acquired synchronously, so
duplicate calls cannot supersede active work before React renders. Session activity badges are scoped
to the selected Agent while background Agent activity remains visible in the Agent catalog.

The stream reducer remains fail-closed. A successful terminal event must agree with all accepted
text, reasoning, and tool presentation; malformed or post-terminal events cannot be hidden by an
adapter. Failed/cancelled partial output remains explicitly incomplete and is not committed as
successful history. Target-keyed operation ownership suppresses stale results and performs
deterministic unmount cleanup without binding the application to a global store library. Compaction
is not inferred by this application.

Completion is provisional until the interaction port settles successfully. The HTTP adapter holds
its terminal frame until clean EOF; trailing events or data invalidate the stream. The application
does not publish successful history or commit callbacks when a port rejects after `completed`.
Transport failure does not prove that the backend rolled back: authoritative history must still be
reconciled after an interrupted connection.

Conversation and Agent Profile are separate URL-restorable views. Profile owns model settings,
display name, config and lifecycle; Conversation owns the transcript and Composer. “New” goes directly
to a fresh conversation and focuses its Composer. Unsaved Profile edits require explicit discard
before selection/view changes, including browser navigation. Already submitted work is not treated
as an unsaved edit; stale-result guards still apply.
The transcript is a continuous sequence of user bubbles and unframed assistant text, not a card per
exchange. Thought-process and tool details are plain disclosures, collapsed by default even during
streaming. Readable reasoning stays separate by model turn; single-block labels omit technical
numbering. A quiet, always-visible action bar follows authoritative completed Turns. Optional
Fork/Rewind commands remain directly reachable; timestamps appear on hover or keyboard focus of
the metadata icon. Working, failed, cancelled, and provisional-completed Turns do not expose this
success-only bar. Rewind still requires explicit application-owned confirmation.
None of these presentation choices changes runtime, persistence, failure or cancellation behavior.

The application has a viewport-bounded shell: transcript, navigation and optional Session inspector
scroll independently while the Composer remains reachable. It uses stable DOM reading order:
header, sidebar, main, then inspector. Responsive CSS does not silently hide or reorder regions;
navigation and Session details can be toggled explicitly.
Session details use the existing modal Drawer on narrow layouts, leaving conversation layout space
intact; wider layouts use the inspector region.

Run the bounded Web build and qualification with:

```sh
pnpm --filter @ta-agent/ui-agent-web test
```

Build and run the full local application:

```sh
pnpm --filter @ta-agent/ui-agent-web build
pnpm --filter @ta-agent/ui-agent-web serve --root /absolute/path/to/agents
```

Open `http://127.0.0.1:4174`. Create an Agent and configure its model connection in the UI.
There is no implicit offline Engine or global provider file. For credentials and a separate Vite development server, see
[local host setup](./docs/local-host.md). `dev` alone starts the frontend, not the backend.

Agent and Session selection are restored from the URL; branch selection remains a revision-guarded
backend operation, not a route mutation. Theme preference is application-owned browser storage.
Reloading the browser cancels its owned streams; durable background execution/reconnect is not
claimed. See [composition](./docs/composition.md) and [boundary limits](./docs/backend-boundary.md).
