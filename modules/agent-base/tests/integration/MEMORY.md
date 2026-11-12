# Public Memory management consumer qualification

`test/memory-management-consumer.test.ts` is a second application consumer, independent of Agent Web.
All cross-package imports use public entry points.

- `consumers/direct-context-memory.ts` supplies typed factories without Registry access. The caller
  owns a wrapped SQLite store and a formal counter; native Bundle workflows implement the operations.
- A named Step and a complete apply Workflow graph are replaced while the generic management Service
  and native publication/CAS/receipt rules remain unchanged. Replay skips the custom graph entirely.
- The other scenario uses the official Directory setup with Context and Retrieval, formal embedding,
  and a real SQLite worker. Reopen preserves both authorities. Recovery of the original request does
  not increment embedding calls. Missing model access prevents new indexed work, not existing content
  reads, receipt recovery or deletion. Another Agent does not see that Memory Space.
- Every operation is awaited before caller-owned resource close; the filesystem is removed only after
  those resources close. There is no hidden global owner or Service-owned adapter shutdown.

Run after dependency builds:

```sh
pnpm --filter '@print-an-agent/base-integration-tests^...' --if-present build
pnpm --filter @print-an-agent/base-integration-tests typecheck
pnpm --filter @print-an-agent/base-integration-tests test
```

Failure/cancellation/cleanup evidence also lives in Standalone's `context-memory-failures.test.ts`,
`retrieval-memory-failures.test.ts`, and Agent Web's `memory-host-lifecycle.test.ts`. UI behavior is
qualified in `memory-ui.test.tsx` against an isolated Node/HTTP/SQLite Host, not a DOM replacement of
server globals. None of these tests call a production embedding provider or generative model.
