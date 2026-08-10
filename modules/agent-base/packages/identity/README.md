# `@ta-agent/base-identity`

Stable Agent identity primitives and adapter-driven lifecycle catalogs.

An Agent ID is a logical namespace key, not a filesystem path. Adapters must still enforce path
containment and storage isolation independently.

```ts
import { defineAgentIdentity } from '@ta-agent/base-identity';

const identity = defineAgentIdentity({
  id: 'bro',
  displayName: 'Bro',
});
```

`id` is the immutable key used to address config, sessions, and resources. `displayName` is
presentation data and never storage authority. Catalog snapshots add an independent `active` or
`disabled` lifecycle state, CAS revision, and timestamps. The package provides Memory and versioned
SQLite adapters plus create/read/list/disable/reactivate application functions. It deliberately has
no hard delete, ID mutation, filesystem layout, or product personality semantics.

SQLite paths are explicit and reject symbolic links. A caller may share one SQLite file with other
Agent Base adapters because every package owns separate namespaced schema metadata and tables.
