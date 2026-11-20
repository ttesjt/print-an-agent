# `@print-an-agent/base-identity-config`

Stable Agent identity catalogs and storage-agnostic configuration in one dependency-free package.
Identity and Config retain independent lifecycle contracts, revisions and persistence ports.

## Public entries

| Entry                                           | Contract                                                               |
| ----------------------------------------------- | ---------------------------------------------------------------------- |
| `@print-an-agent/base-identity-config`          | Deliberate named aggregate of both capabilities                        |
| `@print-an-agent/base-identity-config/identity` | Identity values, validation, catalog lifecycle and metadata operations |
| `@print-an-agent/base-identity-config/config`   | Config codecs, JSON values, snapshots, resolution and CAS writes       |

```ts
import { defineAgentIdentity } from '@print-an-agent/base-identity-config/identity';
import { resolveAgentConfig } from '@print-an-agent/base-identity-config/config';
```

The root and subentries re-export the same implementations and branded `AgentId` type. Identity-only
consumers use `/identity`; Config consumes Identity types through that feature's entry. Identity
remains independent of Config. All other package subpaths are private.

Read the [Identity contract](./docs/identity.md) and [Config contract](./docs/config.md). Official
Memory and SQLite adapters remain in `@print-an-agent/base-local-adapters`; callers inject their own
ports. This package selects no storage, provider, Workflow, application host or resource namespace.

## Source organization

```text
src/
  index.ts                 # Explicit package aggregate
  identity/
    index.ts               # Identity API, including Catalog re-exports
    values.ts              # ID validation and immutable Identity construction
    errors.ts              # Runtime Identity error class
    types/                 # Primitive Identity types and error codes
    catalog/
      index.ts             # Catalog child-feature API
      queries.ts           # Read and list
      lifecycle.ts         # Create, disable and reactivate
      metadata.ts          # Rename with independent Identity CAS
      snapshot.ts          # Snapshot construction and adapter-result checks
      types/               # Snapshots/status, ports/requests and operation options
  config/
    index.ts               # Config API
    agent-config.ts        # Resolve and CAS write flows
    codec.ts               # Codec validation, round trips and error translation
    snapshot.ts            # Adapter snapshot checks and decoding
    value.ts               # Bounded JSON normalization and local traversal state
    errors.ts              # Runtime Config error class
    types/                 # Serialization, snapshots, adapters, options and error codes
```

Config's dependency on Identity is type-only. Identity and Config revisions remain independent: renaming/disabling an Identity does not
write Config, and resolving a Config default does not persist it. Persistence schemas, IDs, codec
behavior and error classes retain their existing contracts.

## Import migration

The two former packages are replaced by this package:

| Previous package                | New feature entry                               |
| ------------------------------- | ----------------------------------------------- |
| `@print-an-agent/base-identity` | `@print-an-agent/base-identity-config/identity` |
| `@print-an-agent/base-config`   | `@print-an-agent/base-identity-config/config`   |

Declare `@print-an-agent/base-identity-config` once in the consumer manifest, even when using both
subentries. The former package wrappers are removed. Identity's 26 and Config's 13 public symbols
retain their names; the root explicitly aggregates all 39. Config is now part of the reviewed public
release together with Identity.

Run `pnpm test:identity-config-qualification` from the repository root. Independent npm/pnpm tarball
consumers are covered by `pnpm release:prepare` and `pnpm release:verify`.

Tests consume compiled public entries. Test, coverage and watch commands prepare their initial
build. During watch development, run `pnpm dev` alongside `pnpm test:watch` so source changes rebuild
the public output consumed by tests.

## Verification and boundary coverage

`test/identity-config-architecture.test.ts` declares the Catalog child boundary and its shared
Identity foundation, rejects private/aggregate imports, and checks the one-way dependency layers
including type-only edges. It also scans built Config JavaScript to verify that no runtime
Identity dependency remains. These checks reuse the repository's source-boundary tooling; they
cover literal module paths rather than computed imports or runtime ownership.

Tests are grouped by the same owners: Identity values and Catalog queries/lifecycle/metadata,
Config operations/codecs/snapshots/JSON values, plus public-entry compatibility and compile-time
fixtures. Type placement, responsibility names and semantic ownership still require code review.
