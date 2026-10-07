# Agent UI Component Gallery

Developer visual qualification application for the public Agent UI component surface.

The Disclosure activity section demonstrates all six manual/auto-expand/auto-expand-and-collapse
combinations with bounded or natural-height reasoning content. Start, append, finish and reset are
explicit deterministic application actions, not provider lifecycle detection. Manually toggle a
block to take over automatic behavior. Navigation also exhibits all three semantic height limits.

The Gallery imports reusable components only through `@ta-agent/ui-react` public exports and loads
the optional default visual system explicitly. It has no Agent Base backend, transport, product
state, or reusable component implementation of its own. It currently qualifies Panel, layout,
App Shell, themes, actions, form controls, accessible field relationships, and feedback states.
It also exercises modal Dialog and Drawer lifecycle, nested overlays, confirmation pending state,
Tabs keyboard modes, Disclosure, and Navigation Rail structure.
Action bar previews cover mixed commands/links/information, disabled/pending/read-only Turn
capabilities, and all four tooltip placements. Hover, keyboard focus, Escape, viewport edges, and
the timestamp tooltip inside the conversation scroll region are manual qualification surfaces.
It also qualifies Agent catalog boundary states, details, application-defined config slots,
revision-conflict presentation, and optional disable/reactivate capabilities without connecting a
backend.
Session previews cover catalog boundary states, details, rename entry, active/retired lifecycle
capability sets, and branch selection without connecting a backend or owning application state.
Conversation previews cover completed, streaming, and failed Turns; model-turn reasoning blocks;
sanitized tool activity; transcript loading; and idle/streaming Composer states.

The separate `consumer.html` qualification entry exercises an independent Notes consumer without
Agent ports, stores or business state. `?styles=none` imports no stylesheet;
`?styles=default` imports the public default; `?styles=custom` adds an application-owned token
override. The Gallery navigation links to all three modes. Behavior and ARIA relationships are
unchanged. This small fixture is not a second component framework or product application.

Gallery-only CSS uses the `ta-ui-gallery-*` namespace. It may arrange preview frames but must not
target or repair public `ta-ui-*` component hooks.

Run its production build and qualification with:

```sh
pnpm --filter @ta-agent/ui-component-gallery test
```

Run it locally with `pnpm --filter @ta-agent/ui-component-gallery dev`.
