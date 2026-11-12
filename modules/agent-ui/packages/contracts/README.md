# `@print-an-agent/ui-contracts`

Browser-safe ports and view models consumed by Agent UI applications.

These contracts describe UI needs rather than backend runtime objects. Concrete applications adapt
their backend API to these ports at the application composition boundary.

Agent management is split into narrow catalog, inspection, creation, configuration, and lifecycle
ports. Configuration payloads are generic and remain application-owned. Revisions are opaque
compare-and-swap tokens; consumers must return the exact revision they read and must not perform
arithmetic on it.

Session management follows the same narrow-port rule. Catalog/inspection, metadata, lifecycle,
optional purge, and navigation are separate capabilities. The catalog uses opaque cursor pagination;
metadata and navigation revisions are independent compare-and-swap tokens. A draft conversation is
application state rather than a fabricated persisted Session, so this package does not expose a
`createSession()` command. Navigation exposes inspection and branch selection; the optional branch
mutation capability creates non-destructive fork or rewind branches from an explicit Turn. It does
not rewrite existing history. Compaction still has no browser consumer and remains outside the
contract.

Conversation capabilities are split into a paged history query, a sequential interaction stream,
and optional turn-level branch mutations. The stream projects only browser presentation events:
text deltas, model-turn-indexed reasoning deltas, sanitized tool activity, and explicit terminal
outcomes. A completed event includes the canonical persisted Turn. Safe tool activity contains a
display label, summary, and labelled string details only; adapters must not expose raw tool
arguments/results, traces, credentials, or provider payloads through this contract.

An adapter can emit `session-admitted` once after `interaction-started` and before model content,
when authoritative Session identity and navigation are available. This enables immediate catalog
visibility without inventing a durable ID in the browser or waiting for model completion. Its
details/navigation must agree with each other and the requested target; completion must retain
that Session/branch. Admission does not imply a successful Turn. Replays may have no new admission.

Non-cancellation outcomes use `AgentManagementResult`. Its failures are browser-safe projections
for validation, conflicts, missing records, unavailable capabilities, and operation failure.
Cancellation continues to use the caller's `AbortSignal` and rejects the operation instead of being
misrepresented as a domain failure. Agent ID is immutable. Applications with a real metadata
authority may install the optional `AgentMetadataPort` for CAS display-name changes; this does not
change config or Session identity and is not a requirement on every backend.

# Collection locators

`CollectionReference` is non-secret JSON interpreted by the application, not a storage-kind
union. `CollectionChoice.key` is canonical identity supplied by that application's resolver;
choices in one list must have unique keys. `CollectionAccessPort` only opens a reference into
an application-owned connection. It does not replace Agent, Session or interaction ports.

# Workspace capabilities

`WorkspacePorts` groups narrow capabilities without requiring a configuration schema. Agent reads
use `listAgentPage` and `inspectAgentDetails`; catalog cursors are opaque and selection may refer to
an Agent outside the loaded page. A backend without pagination returns a single page, without
claiming server-side paging. Metadata/lifecycle mutations, purge and branch mutations are optional.
Consumers must not install dummy implementations to advertise unavailable capabilities.

`MutationOutcome` distinguishes confirmed commits (possibly with safe follow-up notices), known
rejections, and indeterminate outcomes. A lost response or cancellation is not proof of rollback.
`committed` is an interaction terminal receipt for a durable Turn whose presentation is not ready;
it does not fabricate a canonical `completed` Turn. Recover presentation by querying authority,
never by resubmitting the message. Like every terminal, it is accepted only after clean stream
settlement. Backend adapters remain responsible for authoritative identity and safe projection.
