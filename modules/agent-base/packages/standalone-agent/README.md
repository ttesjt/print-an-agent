# `@ta-agent/base-standalone-agent`

Standalone TypeScript constructors accept host-owned `stepOverrides`, forwarded through explicit,
managed-directory, and shared-SQLite profiles to the standard composition. For example,
`captureReasoningPresentation: SKIP_STEP` disables saved reasoning without affecting live delivery.
These executable overrides are not Agent JSON configuration or stored managed manifests. Official
Session adapters support atomic turn presentation; explicit display queries are available on the
same wrapped Agent's Session resource through `supportsSessionPresentation()` and
`readTurnPresentation()`. The CLI remains text-only.

The official standalone reference Agent application boundary.

`defineStandaloneAgentConfig()` decodes one closed `schemaVersion: 1` JSON-compatible value.
`createStandaloneAgent()` selects the ordinary provider-backed `AgentAPI` plus an explicit Memory or
absolute-path SQLite persistence profile. The API is a transparent delivery convenience and exposes
its underlying composed `Agent`. SQLite composes both Session and Request Journal adapters over the
supplied database. Credential references bind only to a named environment reader; API keys never
belong in configuration.
Standalone OpenAI-compatible provider JSON must explicitly declare `supportsReasoning`; the field is
preserved in managed Config and `agent.json`. It declares endpoint capability and does not enable a
reasoning effort or guarantee that a response contains readable reasoning. The same provider object
must declare `compatibility.supportsDeveloperRole`. This independent, non-secret decision is also
preserved through managed Config and `agent.json`; unknown endpoints should conservatively use
`false` unless their message-role behavior has been verified.

This package depends on `@ta-agent/base-composition` and official concrete adapters. It does not
import or expose the internal Pi adapter.

All three TypeScript SQLite construction paths accept an optional host-level `tablePrefix` and
per-domain `tableNames` overrides. The profile resolves Identity, Config, Session, Request Journal,
and managed namespace names before opening storage and rejects cross-domain collisions. This is
deployment wiring only: the closed standalone JSON config, managed creation manifest, `agent.json`,
CLI schema, Agent, Workflow, and Steps never contain table names. Direct adapter users can configure
the same options without this package.

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

## Session management

`createManagedStandaloneSessionService()` accepts an Agent namespace resolver and a narrow Session
management port factory. Its methods do not construct a runtime Agent or read provider credentials.
The official `createStandaloneDirectorySessionService()` and
`createSharedSqliteStandaloneSessionService()` constructors select the corresponding SQLite
namespace and table naming profile. They are separate entry points from the Agent registry; use the
same root or database path and the same `sqlite` options when constructing both.
The management constructors require the selected Session and Journal schemas to already exist:
omitting a custom table prefix or table-name override fails instead of silently creating a new,
empty table family. A database containing multiple complete table families cannot reveal which
one the host intended, so the host must still supply the registry's exact naming options.

```ts
import {
  createStandaloneAgentDirectory,
  createStandaloneDirectorySessionService,
} from '@ta-agent/base-standalone-agent';

const rootDirectory = '/explicit/application/agents';
const agents = createStandaloneAgentDirectory({
  rootDirectory,
  readEnvironmentVariable: (name) => process.env[name],
});
const sessions = createStandaloneDirectorySessionService({ rootDirectory });
const agent = await agents.create(manifest);
const active = await sessions.list({ agentId: agent.identity.identity.id, limit: 20 });
```

The service exposes active and retired lists, exact lifecycle inspection, bounded Turn pagination,
metadata-CAS retire/restore, explicit coordinated Session + Request Journal purge, and explicit
recovery by execution revision. `purge` requires the exact confirmation literal. Retired Sessions
remain readable, including their Turn ledger. A disabled Agent's namespace remains manageable;
disabling only prevents runtime opening. Missing Agent namespaces produce
`STANDALONE_AGENT_NOT_FOUND`; missing Session reads follow the underlying query port's `undefined`
semantics. Busy, conflict, stale-credential, and purge errors retain their Session domain codes.

The generic service requires a `CoordinatedSessionMaintenance` port for purge and recovery, so a
custom composition cannot claim Session + Journal cleanup by supplying only a Session adapter. It
checks the exact Agent namespace before obtaining management ports and binds request identity before
asynchronous resolution. Authorization for management actions belongs to the calling application.
The service does not add methods to `Agent`, `AgentAPI`, Agent Operations, or the Agent registry.
