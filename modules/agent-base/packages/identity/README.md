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
`disabled` lifecycle state, CAS revision, and timestamps. The package provides
create/read/list/disable/reactivate application functions over an injected catalog port. It
deliberately has no concrete storage choice, hard delete, ID mutation, filesystem layout, or product
personality semantics.

Official Memory and SQLite implementations live in `@ta-agent/base-local-adapters`. Consumers may
use those local implementations or provide any catalog adapter that satisfies this package's port.
