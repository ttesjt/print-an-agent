# `@ta-agent/ui-contracts`

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

Non-cancellation outcomes use `AgentManagementResult`. Its failures are browser-safe projections
for validation, conflicts, missing records, unavailable capabilities, and operation failure.
Cancellation continues to use the caller's `AbortSignal` and rejects the operation instead of being
misrepresented as a domain failure. Agent identity currently supports creation and lifecycle only:
an Agent ID is immutable, and display-name mutation is intentionally outside this contract until a
backend authority supports it.
