# Agent Web

General-purpose Agent Web application composition root.

This application owns Agent lifecycle, Session management, conversation
interaction, routing, application-wide state, backend transport, and the adapter to an Agent
runtime. Those responsibilities remain application policy and do not flow into reusable UI
packages.

The default browser composition installs validated localhost HTTP/NDJSON ports and imports the
optional default stylesheet explicitly. The Node host connects these ports to public Agent Base
services and an actual Agent, with directory/SQLite or injected Memory persistence. Provider
provisioning and credentials stay on the host. The Agent adapter implements
catalog, inspect, create, configuration revision checks, disable, and reactivate. The Session adapter
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
an unsaved conversation draft; persistence remains the responsibility of the first successful
interaction. Metadata and navigation can complete concurrently without overwriting one another;
revision conflicts remain visible until an authoritative reload reconciles both selected details and
the current catalog. A failed Session inspection exposes the same retry/reconciliation path.

Conversation state is keyed by persisted Agent, Session, and branch identity. Persisted interactions
can continue concurrently while selection changes; each target owns its history cache, Composer
draft, live/partial Turn, cancellation, and error state. Returning to a target restores that state,
and cancelling the selected target does not cancel another target. An unpersisted new-conversation
draft remains foreground-only: leaving it cancels and discards its temporary state, while successful
completion migrates it to the canonical persisted Session target.

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

The composition uses the public App Shell and layout primitives with a stable semantic order:
header, sidebar, main, then inspector. Default responsive CSS reflows those regions without hiding
or reordering them.

Run the bounded Web build and qualification with:

```sh
pnpm --filter @ta-agent/ui-agent-web test
```

Build and run the full local application:

```sh
pnpm --filter @ta-agent/ui-agent-web build
pnpm --filter @ta-agent/ui-agent-web serve --root /absolute/path/to/agents
```

Open `http://127.0.0.1:4174`. The default Engine is an offline demonstration, not a model
prediction. For provider provisioning and a separate Vite development server, see
[local host setup](./docs/local-host.md). `dev` alone starts the frontend, not the backend.

Agent and Session selection are restored from the URL; branch selection remains a revision-guarded
backend operation, not a route mutation. Theme preference is application-owned browser storage.
Reloading the browser cancels its owned streams; durable background execution/reconnect is not
claimed. See [composition](./docs/composition.md) and [boundary limits](./docs/backend-boundary.md).
