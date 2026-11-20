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
  index.ts             # Explicit aggregate API
  identity/            # Identity implementation and its public entry
    catalog/           # Catalog lifecycle, metadata and snapshot validation
    lib/               # Identity primitive validation
    types/             # Existing Identity declarations and error definitions
  config/              # Config implementation and its public entry
    lib/               # Resolution, writes and JSON normalization
    types/             # Existing Config declarations and error definitions
```

These feature boundaries preserve the existing implementations. Config's dependency on Identity is
type-only. Identity and Config revisions remain independent: renaming/disabling an Identity does not
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
