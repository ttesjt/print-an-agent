# Collection selection and binding

A Collection is an application connection boundary, not an Agent Base domain object, storage
format, provider setting or universal resource adapter. Agent, Session and conversation ports keep
their existing contracts. The connection supplying those ports is selected before mounting the
workspace.

## Reusable contract

`CollectionReference` is non-secret, serializable JSON: an opaque string, primitive, array or object.
There is no framework storage-kind union or required directory field. A consuming application owns
its reference schema, validation and resolver. Do not put credentials, executable code or live
connections in a reference.

`CollectionChoice` supplies a canonical `key`, human-readable `label`, optional description and the
reference. The resolver supplies identity; JSON serialization, display names and array positions
are not identity algorithms. `CollectionAccessPort<Connection, Reference>` opens only that locator
into an application-owned connection. Agent and Session methods do not move into this port.

`CollectionList` presents choices and controlled selection callbacks. `CollectionSetupForm` owns
form structure, pending/error presentation and an application field slot, not a config schema.
The Gallery demonstrates both string and unrelated object references. Reusable packages remain
independent of Agent Base, Node, HTTP, filesystem APIs and browser persistence.

## Directory implementation

Agent Web supplies the concrete `{ rootDirectory: string }` locator. The host requires an absolute
path, creates a missing directory on an explicit open, checks access and canonicalizes filesystem
aliases using `realpath`. A filesystem root is not a Collection. The canonical directory determines
a stable opaque key. One host services instance per key retains runtime fences and coordinated
persistence; there is no mutable host-global current root.

The directory browser lists up to 200 child directories at a time. Entering a path directly remains
available; browsing and opening are separate actions. It operates on the host filesystem, not the
browser user's filesystem. This implementation is for a trusted local machine. A remote deployment
needs an authorized resolver and its own access policy, not unrestricted local path entry.

`--root /path` is a path-only CLI shortcut. Relative CLI paths are resolved against the host's
working directory, then use the same resolver as UI opening. It skips selection on a fresh entry.
Without `--root`, the entry shows Collections and does not invent a directory or auto-enter the
last Collection. An explicit `#collections` route still opens selection even with a startup root.

## Routing and scope

- `#collections` is the selection route.
- Workspace URLs carry the canonical Collection key plus optional Agent, Session and view fields.
  They never contain paths, references, provider configuration or secrets.
- A URL key is not authority or an authentication token. Restoration resolves a known safe reference,
  reopens it through the host and checks canonical identity before mounting the workspace.
- Unknown/unavailable keys return to selection with recovery feedback. A changed filesystem alias
  cannot silently bind an old URL to another Collection.
- Commands and streams use `/api/collections/<key>/commands` and `/interactions`. Each request
  resolves an immutable binding; tabs can use different Collections simultaneously.
- The workspace is keyed by Collection identity. Identical Agent/Session IDs across Collections do
  not share drafts, caches, operations or selection. Obsolete reads are cancelled; late results
  cannot update a newly mounted scope. Remount the application root if replacing the host itself.
- Switching is blocked while interactions, model probes or mutations are active. Finish or explicitly
  cancel them first. Unsaved Profile/create/rename edits and Composer drafts require explicit discard.
  Browser navigation uses the same boundary. Switching is not resource deletion.
- Discard confirmation authorizes the current draft snapshot, not new edits made during resolution
  or opening. Both successful binding and unavailable-reference recovery recheck that authority.
  A newer navigation, including returning to the bound Collection, cancels and supersedes older work;
  late results cannot change the selected Collection even if an adapter ignores cancellation.
- Cooperative cancellation does not roll back already-started commit I/O. A late commit remains in
  its original Collection; authoritative reconciliation is still required after interruption.

The fixed-port server option remains useful for an embedded application or qualification fixture.
It is mutually exclusive with the directory Collection host, not an implicit fallback.

## Recent history

`RecentCollectionsPersistencePort` is a separate optional capability. Applications can provide memory,
browser or other persistence without changing selection components or domain ports. Agent Web's
default adapter stores only canonical directory references, labels and last-used timestamps in
origin-scoped `localStorage`, with a 12-entry MRU bound and canonical-key deduplication.

Only successful opens are remembered. Reopening always revalidates the reference. Corrupt records
are ignored; blocked/quota-failed storage becomes a non-blocking warning with in-tab history.
Writes within a tab are serialized so an older write cannot resurrect a forgotten record.
The initial history load and subsequent edits share that same per-port queue, so slow adapters merge
new remembers into existing history and preserve the order of forget/clear. After a failed save,
in-tab history remains in use until a subsequent save succeeds rather than reverting to stale storage.
Cross-tab history updates refresh the list, never the active Collection. The cache is best-effort convenience,
not transactional cross-tab authority, and may contain local directory names/paths.

Forget and clear affect browser history only; they never purge Session data or remove directories.
Changing origin or clearing browser storage loses convenient URL-to-reference lookup; a startup
root or manual selection can restore access. No durable active selection, remote authentication or
background stream reconnect is claimed.

## Qualification

Tests exercise selection/opening, canonical aliases, identical identities in separate roots,
scoped real HTTP/NDJSON interaction, readable reasoning, saved history after host restart, URL
restoration, guarded edits/drafts, explicit cancellation, optional storage failure and resource-safe
forget/clear. Public component tests and architecture gates enforce the reusable package boundary.
