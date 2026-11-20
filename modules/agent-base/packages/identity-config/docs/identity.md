# `@print-an-agent/base-identity-config/identity`

Stable Agent identity primitives and adapter-driven lifecycle catalogs.

An Agent ID is a logical namespace key, not a filesystem path. Adapters must still enforce path
containment and storage isolation independently.

```ts
import { defineAgentIdentity } from '@print-an-agent/base-identity-config/identity';

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

Official Memory and SQLite implementations live in `@print-an-agent/base-local-adapters`. Consumers may
use those local implementations or provide any catalog adapter that satisfies this package's port.

`renameAgentIdentity()` changes only `displayName`, using the Identity revision for CAS. It preserves
the ID, lifecycle and creation timestamp. Catalog `rename` is an optional metadata capability;
unsupported custom catalogs return `AGENT_IDENTITY_METADATA_UNSUPPORTED`. Official Memory/SQLite
adapters support it. Managed composition exposes the same authority through `service.rename()` and
reconciles projections without materializing an Agent or changing Config/Session resources.

## Source ownership

`identity/values.ts` owns ID validation and immutable Identity construction. Its primitive types
live in `identity/types/identity.ts`; the runtime error class lives in `identity/errors.ts`, with
its error-code union in `identity/types/errors.ts`.

`identity/catalog/index.ts` is the internal Catalog feature entry. Catalog owns its snapshot and
status types, storage ports and requests, and operation options in `catalog/types/`. The enclosing
Identity entry deliberately re-exports that API. Catalog consumes the explicitly shared primitive
values, types and error implementation directly; it never imports the enclosing aggregate.
These source entries do not add public npm subpaths.

Within Catalog, `queries.ts` owns read/list and `lifecycle.ts` owns create/disable/reactivate.
`metadata.ts` owns rename, including its optional capability and pre-write revision checks.
`snapshot.ts` owns snapshot construction and adapter-result normalization, shared by queries and
lifecycle operations. Rename uses the same snapshot constructor and additionally checks that the
adapter preserved lifecycle and creation authority.
