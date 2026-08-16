# Repository architecture

- [Agent Base](../modules/agent-base/README.md) owns agent execution, Sessions, and composition.
- [Model Workbench](../modules/model-workbench/README.md) owns model execution, training, and artifact management.

Workspace libraries use the `@ta-agent/*` scope. Consumers declare dependencies in their own
manifests and import public package entry points. Modules own their apps, libraries, adapters,
fixtures, and tests. The repository root owns shared tooling and architecture checks.
