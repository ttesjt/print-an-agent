# Agent UI

Agent UI is a browser-facing module for composing Agent applications from replaceable UI ports,
unstyled React behavior, and an optional default visual system.

Reusable packages depend only on UI-owned contracts and external UI libraries. They do not import
Agent Base, Model Workbench, or product runtime objects. Concrete applications own
the adapters that connect those contracts to a backend.

The module keeps behavior and visual policy separate:

- `@ta-agent/ui-contracts` owns browser-safe ports and view models.
- `@ta-agent/ui-react` owns structure, behavior, accessibility, and stable global style hooks. It
  contains no component-local stylesheet and does not import a default theme.
- `@ta-agent/ui-styles` owns the optional default tokens, theme, base rules, and global semantic
  classes.
- `@ta-agent/ui-agent-web` is the general-purpose Agent Web application composition root.
- `@ta-agent/ui-component-gallery` is the developer visual-qualification application for the
  public component surface.

Applications may import `@ta-agent/ui-styles/default.css`, override its tokens or semantic classes,
or omit it and provide their own implementation of the style hooks.

Reusable components are store- and transport-agnostic. They consume UI-owned view models and narrow
ports or receive controlled data and callbacks through props. Backend DTO mapping, runtime
validation, routing, application-wide state, and optional capability installation belong to the
application composition boundary.

See [the architecture contract](./docs/architecture.md) for package and component rules, and
[the capability map](./docs/capability-map.md) for the reusable UI scope and ownership boundary.

## Applications

`apps/` contains independently started, built, or deployed application composition roots.

`apps/agent-web` is the complete Agent application surface. It will own Agent lifecycle, Session
management, conversation interaction, routing, application-wide state, backend transport, and the
adapter to an Agent runtime. Its current deterministic adapter remains a walking skeleton.

`apps/component-gallery` is a deterministic developer application for reviewing component states,
themes, responsive layout, accessibility, and semantic DOM. It has no backend or formal business
state and is not a second component framework.

Application-specific behavior must not move into reusable packages unless it has a separately
defined reusable contract and implementation responsibility.
