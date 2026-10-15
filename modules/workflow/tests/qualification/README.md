# Workflow independent qualification

Test-only external consumer of compiled `@ta-agent/workflow-core` exports. No source aliases, runtime
exports, Agent dependencies, or product services. The record-update consumer uses independent input,
ports, state and result types and a real SQLite adapter with revision CAS, owned/closed by the test.

Coverage includes persistence reopen, racing updates, truthful skipped results, negative type
contracts, nested cancellation, managed parallel resource order, borrowed resources, non-cooperative
work, late runners and executor/cleanup failures. This is not a Memory implementation or a second
generic Workflow framework.

Run `pnpm test:workflow-qualification` from the repository root to build before running these tests.
