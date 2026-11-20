# Workflow independent qualification

Test-only external consumer of the compiled `@print-an-agent/workflow-core` root and `/bundle` exports. No source aliases, runtime
exports, Agent dependencies, or product services. The record-update consumer uses independent input,
ports, state and result types and a real SQLite adapter with revision CAS, owned/closed by the test.
Consumers bind their ports at construction and reuse each assembled Workflow across calls.
The record Bundle reuses the same update definition and adds an independently typed, read-only
inspection Workflow over the identical adapter instance.

Coverage includes persistence reopen, racing updates, truthful skipped results, negative type
contracts, standalone and Bundle persistence/CAS, cross-member cancellation with a shared bound SQLite store, nested cancellation, managed
parallel resource order, borrowed resources, non-cooperative
work, late runners and executor/cleanup failures. This is not a Memory implementation or a second
generic Workflow framework.

Run `pnpm test:workflow-qualification` from the repository root to build before running these tests.
