# `@ta-agent/base-standalone-agent`

The official standalone reference Agent application boundary.

`defineStandaloneAgentConfig()` decodes one closed `schemaVersion: 1` JSON-compatible value.
`createStandaloneAgent()` selects the ordinary provider-backed `AgentAPI` plus an explicit Memory or
absolute-path SQLite persistence profile. The API is a transparent delivery convenience and exposes
its underlying composed `Agent`. SQLite composes both Session and Request Journal adapters over the
supplied database. Credential references bind only to a named environment reader; API keys never
belong in configuration.

This package depends on `@ta-agent/base-composition` and official concrete adapters. It does not
import or expose the internal Pi adapter.

`createManagedStandaloneAgentRegistry()` provides the storage-neutral managed lifecycle. It accepts a
typed resource namespace adapter, an explicit factory for the independently shaped Identity, Config,
Session, and Request Journal ports, and an optional manifest projection. The lifecycle contains no
filesystem or database path policy and does not use a universal resource adapter or registry.

`createStandaloneAgentDirectory()` is the default managed reference profile at one explicit absolute
root:

```text
<root>/<agent-id>/agent.json
<root>/<agent-id>/agent.sqlite
```

Each Agent has one directory and one SQLite database containing its Identity lifecycle, Config,
Session, and Request Journal authority. Creation publishes through a hidden staging directory and
atomic rename. `agent.json` is a secret-free portable projection; SQLite Config is revision
authority, and inspect/open repairs a missing or stale projection. The directory API supports
create, inspect/list, Config CAS updates, disable/reactivate, and opening the existing `AgentAPI`.
Disabled Agents retain state but cannot open. Hard delete, Agent ID rename, implicit roots, and
credential persistence are intentionally absent.

`createSharedSqliteStandaloneAgentRegistry()` is the alternative managed profile for hosts that want
multiple Agents in one explicitly configured SQLite database. Existing domain tables remain isolated
by Agent ID. A versioned publication marker hides interrupted provisioning until an exact retry can
complete it. This profile creates no Agent directories and has no manifest projection requirement.
