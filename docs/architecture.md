# Repository architecture

- [Agent Base](../modules/agent-base/README.md) owns agent execution, Sessions, and composition.
- [Agent UI](../modules/agent-ui/README.md) owns reusable interface components and reference applications.
- [Model Workbench](../modules/model-workbench/README.md) owns model execution, training, and artifact management.

Workspace libraries use the `@ta-agent/*` scope. Consumers declare dependencies in their own
manifests and import public package entry points. Modules own their apps, libraries, adapters,
fixtures, and tests. The repository root owns shared tooling and architecture checks.

Agent Base Composition defines raw Agent assembly and managed Services. A concrete
profile supplies one Definition and its resource factories. Agent management, Session
navigation, and runtime consume that Definition as sibling Services. Standalone Agent
is a reference profile, and the CLI delegates assembly to it.
