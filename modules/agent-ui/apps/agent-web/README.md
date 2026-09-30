# Agent Web

General-purpose Agent Web application composition root.

This application is the future owner of Agent lifecycle, Session management, conversation
interaction, routing, application-wide state, backend transport, and the adapter to an Agent
runtime. Those responsibilities remain application policy and do not flow into reusable UI
packages.

The application installs a deterministic adapter for the initial walking skeleton and imports the
optional default stylesheet explicitly. It contains no component-local CSS. A product application
can replace the adapter and stylesheet without changing reusable component behavior.

The walking skeleton uses the public App Shell and layout primitives with a stable semantic order:
header, sidebar, main, then inspector. Default responsive CSS reflows those regions without hiding
or reordering them.

Run the bounded Web build and qualification with:

```sh
pnpm --filter @ta-agent/ui-agent-web test
```

Run it locally with `pnpm --filter @ta-agent/ui-agent-web dev`.
