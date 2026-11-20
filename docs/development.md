# Developing Print an Agent

## Validate a standalone checkout

Run these commands from the repository root with Node.js `24.15.0` and pnpm `10.28.0`.
Internal packages are linked within this checkout. No sibling repository or private registry is
needed.

```sh
pnpm install --frozen-lockfile
pnpm test:architecture
pnpm exec tsc --noEmit
```

`test:architecture` builds the TypeScript workspace before checking module boundaries. This
Node.js-only path does not run all package tests or the Python suite.

For the validation profiles, also install Python `3.11` and uv `0.11.x`. Sync all Python
workspace members so the Workbench scaffold and reference backend are both available:

```sh
pnpm python:sync --locked
```

| Profile  | Local command            | Coverage                                                                                                                                     |
| -------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Quick    | `pnpm validate:quick`    | Formatting, workspace build and architecture tests, root TypeScript types, public Agent integration tests, and Python lint, types, and tests |
| Standard | `pnpm validate:standard` | Quick plus typecheck, lint, and tests for directly changed workspace packages                                                                |
| Full     | `pnpm validate`          | Workspace formatting, lint, typechecks, architecture and package tests, and builds                                                           |

Local Standard compares the working tree, including new untracked files, against the merge base
with `origin/main`. To use a different base, pass a Git revision such as
`pnpm validate:standard main`. Markdown changes alone do not select packages.

Changes to Workflow Core or Bundle also run the Workflow qualification typecheck to verify
the public types from an independent consumer.

Local HTTP fixtures need permission to listen on loopback. The default gate does not require
live model credentials. The optional real Transformer backend qualification is a separate
`pnpm validate:model-backend` command.

The [Validate workflow](../.github/workflows/validate.yml) runs Standard on pull requests to
`main`, using the PR merge commit's `main` parent as the base. New commits cancel older runs
for the same pull request.

For shared configuration, lockfile, or public API changes that affect other packages,
run the full gate. Select a branch in the
[Validate Full workflow](../.github/workflows/validate-full.yml) in GitHub Actions to run
`pnpm validate` manually. Merging a pull request does not trigger a second run.

For offline validation, use `pnpm install --offline --frozen-lockfile --ignore-scripts`,
add `--offline` to the uv sync command, and run `UV_OFFLINE=1 pnpm validate`. These commands
require populated dependency and build-tool caches.

## Workspace conventions

Apply the [monorepo standards](standards/monorepo-standards.md) alongside these repository settings:

- [package.json](../package.json) declares the supported Node.js range and exact pnpm version.
  [.node-version](../.node-version) pins the Node.js version for validation.
- [pnpm-workspace.yaml](../pnpm-workspace.yaml) lists TypeScript apps, packages, templates, and
  qualification workspaces. Install once at the repository root and use the shared
  [pnpm lockfile](../pnpm-lock.yaml).
- Declare each dependency in its consumer's manifest. Use `workspace:*` for local packages,
  `catalog:` for dependencies covered by the shared catalog, and explicit pins where the owning
  package requires one. For example, the [Pi adapter](../modules/model-invocation/packages/pi/package.json)
  owns exact Pi SDK versions.
- Regenerate `pnpm-lock.yaml` deliberately when dependencies change, then verify the result with a
  frozen install. The Workbench Python workspace uses uv and has a separate lockfile.
- Build the dependency chain before running a consumer that imports compiled entries. See
  [the package selection examples](standards/monorepo-standards.md#p3-task-selection-and-scope).

### TypeScript package

Copy the [TypeScript package template](../tooling/templates/typescript-package/README.md) into the
owning module's `packages/` directory. Rename the npm package, source symbols, and README before
adding implementation. Library packages use the template's build, lint, format, typecheck, and test
tasks and export compiled runtime files and declarations from `dist/`. Apps, CSS packages, and
qualification workspaces have different entry points and tasks. Use an existing workspace of the
same kind as a reference.

Keep production source in `src/` and tests in `test/`. Use `test/unit/` for focused behavior,
`test/integration/` for public contracts or integration, `test/fixtures/` for inputs, and
`test/support/` for test-only helpers where needed. Name executable TypeScript tests `*.test.ts`
or `*.test.tsx`. Unit tests can import local implementation files. Integration tests should
exercise public package entries where the contract is the subject of the test.

### Python package

The maintained Python model backend template owns an independent uv workspace at
`modules/model-workbench/templates/python-model-backend/python`. Copy its
`template` directory into `packages/<name>`, then rename the distribution and import package.
Add the new package paths to the workspace Mypy targets and extend `python:build` when the new
package needs to be built by the repository gate.

```sh
pnpm python:sync
pnpm python:validate
```

Only modules that need Python own a uv workspace and lockfile.

## Verification

| Change                                | Checks to start with                                                                                                                                                               |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Documentation                         | Check formatting and links. Verify changed commands and examples against the checkout.                                                                                             |
| Package implementation                | Build needed dependencies, then run the affected package's tests, typecheck, lint, and format check.                                                                               |
| Public API or package boundary        | Exercise affected consumers and run `pnpm test:architecture`. Verify a clean build when changing package exports or build inputs.                                                  |
| Module integration                    | Use the relevant module qualification script in [package.json](../package.json), such as `pnpm test:base-composition-qualification` or `pnpm test:model-invocation-qualification`. |
| Cross-workspace behavior or toolchain | Run the full `pnpm validate` gate after the setup above.                                                                                                                           |

Prettier checks formatting. [TypeScript](../tsconfig.base.json) and
[ESLint](../eslint.config.js) check types and common unsafe code. The
[boundary rules](../eslint.boundaries.js) and [architecture tests](../test/architecture.test.ts) check specific
import and packaging constraints. Read the owning checks when assessing a change to those
boundaries. Design questions such as where authority lives, whether validation is complete, and
who releases an acquired resource still require review, even when the checks pass.

### Declared source-feature boundaries

`tooling/architecture/source-boundaries.ts` supplies an opt-in source check. The Session package
declares its entries, shared ancestor contracts/capabilities and dependency directions in
`test/session-architecture.test.ts`; `test/source-boundaries.test.ts` qualifies accepted and rejected
imports. Both run in `pnpm test:architecture`. Other packages do not acquire feature-boundary
coverage simply by containing an `index.ts`.

The check scans all Session production `.ts` sources, including type-only imports, re-exports,
import types and literal dynamic imports. It checks every enclosing boundary, explicitly shared
ancestor entries, imports back through an owning aggregate, dependency direction and wildcard
exports. File entries are allowed for shared responsibility modules. Dependency rules cover the
shared contracts, validation and lineage capabilities as well as domain features. It does not
resolve computed import paths, package aliases, custom loaders or runtime resource ownership;
those still need review. Compiler checks remain responsible for symbol existence and types.
