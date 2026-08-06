# `@ta-agent/base-config`

Storage-agnostic Agent configuration contracts.

The package owns config codecs, snapshots, optimistic revisions, resolution, and write semantics. It
does not know whether an adapter persists to memory, a file, SQLite, or another service.

`MemoryAgentConfigAdapter` is a deterministic reference and test implementation, not a production
persistence policy.

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

Adapters store only JSON-compatible values. They do not parse product config, choose defaults, or
know about Workflow, Pi, sessions, or databases owned by another adapter. Writes use explicit
compare-and-swap revisions; `null` means “create only if absent.” Resolving a default validates it
but does not silently persist it.
