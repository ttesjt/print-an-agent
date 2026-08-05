# Repository architecture

- [Agent Base](../modules/agent-base/README.md) owns workspace for Agent packages.
- [Model Workbench](../modules/model-workbench/README.md) owns python package template and workspace.

Workspace libraries use the `@ta-agent/*` scope. Consumers declare dependencies in their own
manifests and import public package entry points. Modules own their apps, libraries, adapters,
fixtures, and tests. The repository root owns shared tooling and architecture checks.
