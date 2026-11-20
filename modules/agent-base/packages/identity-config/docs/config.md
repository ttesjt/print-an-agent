# `@print-an-agent/base-identity-config/config`

Storage-agnostic Agent configuration contracts.

The package owns config codecs, snapshots, optimistic revisions, resolution, and write semantics. It
does not know whether an adapter persists to memory, a file, SQLite, or another service.

Official Memory and SQLite implementations live in `@print-an-agent/base-local-adapters`; this package
does not select either one.

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
Resolving a default validates it but does not silently persist it.

## Source ownership

`config/agent-config.ts` keeps the resolve and write flows together. Both use `codec.ts` for schema
version validation and codec round trips, and `snapshot.ts` for checking and decoding adapter
results. `value.ts` owns the bounded JSON normalization algorithm and its local traversal state.
`errors.ts` owns the runtime error class.

Pure declarations live in `config/types/`: `codec.ts` groups the JSON value and codec contracts,
`snapshot.ts` describes stored snapshots and resolved results, `adapter.ts` owns storage ports and
write requests, `options.ts` composes operation inputs, and `errors.ts` owns error codes. Operation
options import adapter ports and base contracts; ports import value/snapshot contracts. Base
contracts do not import ports or operation options. References to Identity use type-only imports through its public feature entry.
These responsibility modules remain private npm paths.
