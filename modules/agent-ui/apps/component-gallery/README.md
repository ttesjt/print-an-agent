# Agent UI Component Gallery

Developer visual qualification application for the public Agent UI component surface.

The Gallery imports reusable components only through `@ta-agent/ui-react` public exports and loads
the optional default visual system explicitly. It has no Agent Base backend, transport, product
state, or reusable component implementation of its own. It currently qualifies Panel, layout,
App Shell, themes, actions, form controls, accessible field relationships, and feedback states.
It also exercises modal Dialog and Drawer lifecycle, nested overlays, confirmation pending state,
Tabs keyboard modes, Disclosure, and Navigation Rail structure.

Gallery-only CSS uses the `ta-ui-gallery-*` namespace. It may arrange preview frames but must not
target or repair public `ta-ui-*` component hooks.

Run its production build and qualification with:

```sh
pnpm --filter @ta-agent/ui-component-gallery test
```

Run it locally with `pnpm --filter @ta-agent/ui-component-gallery dev`.
