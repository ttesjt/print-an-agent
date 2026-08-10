# `@ta-agent/base-config`

Storage-agnostic Agent configuration contracts.

The package owns config codecs, snapshots, optimistic revisions, resolution, and write semantics. It
does not know whether an adapter persists to memory, a file, SQLite, or another service.

`MemoryAgentConfigAdapter` is the deterministic reference implementation.
`SqliteAgentConfigAdapter` is the opt-in durable local implementation.

```ts
const codec: AgentConfigCodec<MyAgentConfig> = {
  schemaVersion: 1,
  decode: decodeMyAgentConfig,
  encode: encodeMyAgentConfig,
};

const resolved = await resolveAgentConfig({
  identity,
  codec,
  adapter,
  createDefault: () => defaultConfig,
});
```

The read path is deliberately:

```text
untrusted adapter snapshot → identity/schema/revision checks → codec → resolved config
```

Adapters store only JSON-compatible values. The package validates complete value trees and rejects
cycles, non-finite numbers, non-plain objects, unsupported values, and excessive nesting before
persistence. Adapters do not parse product config, choose defaults, or know about Workflow, Pi, or
sessions. Writes use explicit compare-and-swap revisions; `null` means “create only if absent.”
Resolving a default validates it but does not silently persist it. SQLite storage has its own
versioned schema, defensive decoding, explicit size budget, and restart-safe Agent isolation.
