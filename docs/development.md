# Development

## TypeScript package

Copy `tooling/templates/typescript-package` into the owning module's `packages/` directory. Rename
the npm package, source symbols, and README before adding implementation.

Every package must provide build, clean, test, typecheck, lint, and format scripts and export only
its public `dist` entry points.

## Python package

Model Workbench owns an independent uv workspace at `modules/model-workbench/python`. Copy its
`template` directory into `packages/<name>`, then rename the distribution and import package.
Add the new package paths to the workspace Mypy targets and extend `python:build` to build the
workspace packages once the first real Python package exists.

Run:

```bash
pnpm python:sync
pnpm python:validate
```

Do not create Python infrastructure in modules that do not need Python. If another module later
needs Python, give that module its own uv workspace and lockfile.

## Validation

Run the complete repository gate before handoff:

```bash
pnpm validate
```

Dependencies and tool versions are intentionally pinned. Change them explicitly and review both
lockfiles when upgrading.
