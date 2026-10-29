# Model Workbench Python

Independent uv workspace for Python execution backends used with Model Workbench. Python remains an
optional backend language and is not a dependency of the TypeScript control plane.

`packages/model-backend` is the runnable reference backend. Its source keeps three responsibilities
separate:

- `infrastructure`: language-neutral Workbench wire protocols and local Artifact publication;
- `model`: experiment-owned model behavior with no Workbench imports;
- `composition`: the narrow mapping between protocol requests and model behavior.

The backend provides a real, device-aware tiny Transformer while retaining dependency-free protocol
qualification. PyTorch is an optional model dependency: ordinary protocol tests neither install nor
import it, while the focused CPU smoke runs the complete Workbench lifecycle.

The repository keeps four test responsibilities explicit:

- `architecture` and `unit` protect package boundaries and isolated infrastructure behavior;
- `protocol` qualifies dependency-free JSON/JSONL execution contracts;
- `model` requires PyTorch and exercises actual tensor and checkpoint behavior;
- `integration` requires PyTorch and joins model behavior to the backend composition.

The commands deliberately select directories rather than collecting optional tests and reporting
them as skipped:

```console
pnpm python:validate          # architecture, unit, protocol, typing, lint, and packages
pnpm validate:model-backend  # installs the model extra and requires the real CPU lifecycle
```

The second command is the qualification gate for Transformer behavior. It fails instead of skipping
when PyTorch or the smoke backend is unavailable; it is intended for model-backend development and
its dedicated CI job, not the default repository feedback loop.

Create a standalone copy of the maintained model backend from the repository root:

```console
pnpm scaffold:model-backend -- \
  --target /absolute/path/to/my-model \
  --project-name my-model
```

The scaffold command refuses existing destinations and does not install dependencies, initialize
Git, access the network, or run model training. It prints the generated Python module name required
by the Workbench-side definition.

Copy `template` into `packages/<name>` to create a package, then add its `src` and `tests` paths to
the workspace Mypy `files` list. Do not add Agent Base or product runtime dependencies here.
