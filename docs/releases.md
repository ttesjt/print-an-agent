# npm packages

Public packages use the `@print-an-agent` scope on `https://registry.npmjs.org/`. Source and published
names are identical. The repository root and all packages outside the list below remain private.
The initial coordinated package version is `0.1.0`.

## Package scope

Website consumers install the three entry packages:

```sh
pnpm add @print-an-agent/base-request @print-an-agent/model-invocation-core @print-an-agent/model-invocation-pi
```

The reviewed release also includes the independent `@print-an-agent/base-runtime` entry. Request and
Session do not depend on it; consumers that bind Workflows to Agent Operations install it explicitly.
The four release entries and their production closure contain exactly these ten packages:

- `@print-an-agent/base-request`
- `@print-an-agent/base-actor`
- `@print-an-agent/base-identity`
- `@print-an-agent/base-observability`
- `@print-an-agent/base-runtime`
- `@print-an-agent/base-session`
- `@print-an-agent/base-tool`
- `@print-an-agent/workflow-core`
- `@print-an-agent/model-invocation-core`
- `@print-an-agent/model-invocation-pi`

These are ESM packages for Node.js `>=24.15.0 <25`. A server-side website integration can use the
[Sessionless Workflow](../modules/agent-base/packages/request/docs/sessionless.md) without creating
an Agent or Session. Keep provider credentials on the server. Composition, local adapters, Memory,
UI, Workbench and standalone applications are outside this release scope.

## Prepare and verify

Use the repository's pinned toolchain and lockfile:

```sh
pnpm install --frozen-lockfile
pnpm release:prepare
pnpm release:verify
```

Neither release command publishes anything or needs npm credentials. Both accept an optional output
directory. Preparation refuses an existing directory; use a new directory for a fresh preparation.
The default destination, `temp/npm-release`, is ignored by Git. The manual **Prepare npm packages**
GitHub workflow runs the same commands and uploads the reviewable artifacts without publishing.

Preparation computes the reviewed production closure from the four release entries, cleans and builds it,
then stages a minimal package manifest. Internal `workspace:*` references become exact release
versions; external production dependencies retain their exact pinned versions. There is no package
renaming. Tarballs contain ESM JavaScript, declarations, a package README, and the canonical root MIT
license. Source maps and their trailers are omitted because source files are not shipped. Development
dependencies, scripts, tests, credentials and local paths are not included in the published manifest.
The Pi adapter additionally carries third-party notices and upstream MIT license texts.

Verification inspects the actual tarballs, checks public entries and integrity, then starts a
read-only loopback npm registry serving only these artifacts. An isolated temporary project outside
the workspace declares only the four release entry dependencies. The other six must resolve transitively.
External packages come from the public npm registry. The verifier uses empty user/global npm config
files and removes inherited npm authentication from child processes.

Both `npm ci` and `pnpm install --frozen-lockfile` are exercised, with TypeScript NodeNext compilation
and runtime tests for direct completion, streaming, history, reasoning, backpressure, concurrent
isolation, cancellation and failures. No source aliases, workspace links, API key, or real model are
used. The real Pi parser consumes deterministic localhost SSE responses.

Review these files together:

- `*.tgz`: the packages to publish, in dependency order from `release.json`.
- `release.json`: exact package manifests, integrity hashes, source commit and dirty-tree indicator.
- `verification.json`: successful consumer verification tied to those hashes.
- `dependency-licenses.json`: resolved production dependencies and their declared licenses.

The independent consumer fixture has its own strict TypeScript check against installed artifacts;
the root typecheck cannot supply its external dependencies. Its ESLint override disables only typed
rules, and the independent compiler runs with library declaration checking enabled.

## License and publication review

Our packages use the root MIT license, copyright `2026 ttesjt`. The Pi adapter's
[notices](../modules/model-invocation/packages/pi/THIRD_PARTY_NOTICES.md) credit its pinned direct
dependencies. Transitive packages remain separately installed with their own licenses and notices;
they are not relicensed or bundled into our tarballs. Recheck the inventory and upstream notices
when changing dependencies, especially if bundling code in a future release.

Publication is a separate, explicit action by an npm organization owner. Before publication, review
the source, commit it, rerun preparation and verification from that clean revision, and retain the
matching hashes. Check package-name/version availability and the organization's access and 2FA
requirements. Publish the verified tarballs in `release.json` dependency order using:

```sh
npm publish <verified-package.tgz> --access public --registry=https://registry.npmjs.org/
```

Publishing is not atomic across packages. Do not rebuild different tarballs under an already
published version, and do not infer registry publication from successful local verification. After
publication, run a fresh external install from npm itself; the preparation verifier proves artifact
consumption, not npm account permissions or registry availability. Subsequent coordinated releases
must update the selected package versions together.
