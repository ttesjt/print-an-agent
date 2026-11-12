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

For full workspace validation, also install Python `3.11` and uv `0.11.x`. Sync all Python
workspace members so the Workbench scaffold and reference backend are both available:

```sh
uv sync --locked --all-packages --project modules/model-workbench/templates/python-model-backend/python
pnpm validate
```

`validate` runs format and lint checks, typechecks, architecture and package tests, and builds.
Local HTTP fixtures need permission to listen on loopback. The default gate does not require
live model credentials. The optional real Transformer backend qualification is a separate
`pnpm validate:model-backend` command.

For offline validation, use `pnpm install --offline --frozen-lockfile --ignore-scripts`,
add `--offline` to the uv sync command, and run `UV_OFFLINE=1 pnpm validate`. These commands
require populated dependency and build-tool caches.

Dependencies and tool versions are pinned. Change them explicitly and review both lockfiles
when upgrading.

## TypeScript package

Copy `tooling/templates/typescript-package` into the owning module's `packages/` directory. Rename
the npm package, source symbols, and README before adding implementation.

Every package must provide build, clean, test, typecheck, lint, and format scripts and export only
its public `dist` entry points.

Production source contains no test files. Use this package layout:

```text
test/
├── unit/
├── integration/
└── fixtures/
```

Name executable tests `*.test.ts`. Unit tests may import package source through relative paths;
integration tests should prefer the package public entry point.

## Python package

The maintained Python model backend template owns an independent uv workspace at
`modules/model-workbench/templates/python-model-backend/python`. Copy its
`template` directory into `packages/<name>`, then rename the distribution and import package.
Add the new package paths to the workspace Mypy targets and extend `python:build` when the new
package needs to be built by the repository gate.

Run:

```bash
pnpm python:sync
pnpm python:validate
```

Do not create Python infrastructure in modules that do not need Python. If another module later
needs Python, give that module its own uv workspace and lockfile.
