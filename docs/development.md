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

Changes to Workflow Core, including its Bundle subentry, also run the Workflow qualification typecheck to verify
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
- Agent Base packages normally use the `@print-an-agent/base-*` family.
  `@print-an-agent/agent-actor`, owned by `modules/agent-base/packages/agent-actor`, names the
  Agent-specific permission extension and Responsibility routing over Model Invocation's generic
  Actor. Module ownership and public-entry checks include this name explicitly; its naming does
  not change dependency direction or move the package into Model Invocation.
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

The shared `tooling/architecture/source-boundaries.ts` scanner and cycle checker, and
`tooling/architecture/type-modules.ts` runtime-erasure checker are qualified by
`test/source-boundaries.test.ts` and `test/type-modules.test.ts`. Composition, Runtime and Workflow
reuse the type checker. These opt-in checks inspect supplied literal modules; TypeScript owns
resolution and type correctness.

`tooling/architecture/source-boundaries.ts` supplies an opt-in source check. Session, Composition, Runtime, Request, Tool, Standalone and Local Adapters
declare their entries, shared ancestor contracts/capabilities and dependency directions in
`test/session-architecture.test.ts`, `test/composition-architecture.test.ts`,
`test/runtime-architecture.test.ts`, `test/request-architecture.test.ts`, `test/tool-architecture.test.ts`,
`test/standalone-architecture.test.ts` and `test/local-adapters-architecture.test.ts`. Composition and Runtime also check
their own dependency declarations and runtime erasure of type modules. Workflow Core declares its
boundaries in `test/workflow-source-boundaries.test.ts`. `test/source-boundaries.test.ts` qualifies
the shared checker with accepted and rejected imports. All run in `pnpm test:architecture`, and
Workflow's checks also run in `pnpm test:workflow-qualification`. Identity/Config declares its package
entries, Catalog child entry, shared Identity foundation, and Catalog/Config dependency layers in
`test/identity-config-architecture.test.ts`, which also runs in the aggregate architecture gate and
`pnpm test:identity-config-qualification`. It additionally scans compiled Config JavaScript to verify
that its dependency on Identity is erased. Other packages do not acquire feature-boundary coverage
simply by containing an `index.ts`.

Request, Tool and Standalone additionally check runtime erasure of independent type modules and an
acyclic internal module graph, including type-only edges, using the shared literal source scanner.
The shared scanner and cycle checker are qualified by accepted and rejected cases in
`test/source-boundaries.test.ts`. Cycle checks follow relative literal paths within the supplied
source inventory; the compiler owns unresolved module diagnostics.
Request follows the complete internal Sessionless source closure
to reject Session-aware implementations and direct Session/runtime/local-adapter dependencies.
This closure check follows relative literal imports, not transitive imports inside external packages.
Request package tests guard the runtime export names; consumer typechecks exercise generic Workflow
customization and declaration portability through the compiled public package entry.
Tool guards runtime export names and public type contracts, including nested Schema-derived argument
inference and readonly values.

Standalone declares the outer profiles boundary and all three child profile APIs. Shared Config,
Provider, runtime, Setup, SQLite and Service projection layers cannot depend back on those profiles;
Agent Memory cannot depend on profile implementations. Its package tests preserve runtime export
names and exercise Profile lifecycle, namespace publication, real SQLite reopen and optional Memory
resource selection. Public-package consumers in Base integration tests, CLI and Agent Web exercise
the compiled API; consumer declaration emission checks portable inferred types. Standalone is a
private workspace package and is outside the npm release artifact verification scope.

Local Adapters declares domain entries, Memory/SQLite backend entries, Request Output/Journal
boundaries and the Session-persistence composition layer. It checks one-way dependencies, independent
type erasure and literal source cycles, including type-only edges. Package tests check exact runtime
exports, omitted private coordination methods, real SQLite lifecycle/transactions and the supported
Session v4-to-v5 upgrade versus existing mode without schema initialization. Shared contract suites run against both
Memory and SQLite. Actual Base consumers typecheck through compiled package entries; declaration
emission additionally qualifies portable inferred persistence results. The root public declaration
graph check continues to reject native SQLite type leaks.

The check scans all opted-in production `.ts` sources, including type-only imports, re-exports,
import types and literal dynamic imports. It checks every enclosing boundary, explicitly shared
ancestor entries, imports back through an owning aggregate, dependency direction and wildcard
exports. File entries are allowed for shared responsibility modules. Dependency rules cover the
explicitly declared shared capabilities and feature dependencies in each package. It does not
resolve computed import paths, package aliases, custom loaders or runtime resource ownership;
those still need review. Compiler checks remain responsible for symbol existence and types.

Model Invocation Core declares its capability and nested feature entries in
`test/model-invocation-core-source-boundaries.test.ts`, also included in
`pnpm test:model-invocation-qualification`.
