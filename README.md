# Modular Agent

A modular framework for building agents with replaceable model, workflow, memory, and application components.

- [Agent Base](./modules/agent-base/README.md) — Agent execution, Sessions, and composition.
- [Agent UI](./modules/agent-ui/README.md) — Reusable interface components and reference applications.
- [Model Workbench](./modules/model-workbench/README.md) — Model execution, training, and artifact management.
- [Workflow](./modules/workflow/README.md) — Workflow execution and resource binding.

## Development

- Node.js `24.15.0`
- pnpm `10.28.0`
- Python `3.11` and uv `0.11.x` for Model Workbench

```sh
pnpm install --frozen-lockfile
pnpm python:sync
pnpm validate
```

See [Architecture](./docs/architecture.md) and [Development](./docs/development.md).
