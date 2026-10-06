# `@ta-agent/base-standalone-agent`

The official Standalone application profile for Agent Base.

This package owns Standalone policy: stored Config vocabulary, provider and credential wiring,
timeout policy, SQLite table naming, Memory/filesystem/shared-SQLite profiles, `agent.json` projection, and
the Standard runtime materializer. Generic Agent lifecycle, runtime opening, and out-of-band Session
management belong to `@ta-agent/base-composition`; Standalone consumes those services rather than
reimplementing them.

## Config vocabulary

`StandaloneAgentConfig` is the authoritative managed Config. It contains provider, credential binding,
main Actor, Request, and Session compaction policy. `STANDALONE_AGENT_CONFIG_CODEC` is its canonical
Config authority codec. Memory keeps revisioned authority for the lifetime of its profile scope;
filesystem and shared-SQLite profiles persist it across processes.

`StandaloneAgentBootstrapConfig` adds Identity and a Memory or explicit SQLite persistence choice.
`defineStandaloneAgentBootstrapConfig()` validates it; asynchronous `createStandaloneAgent()`
initializes authority and opens one Agent through the canonical Definition and narrow Services.
Single-Agent convenience and multi-Agent hosting follow the same application composition path.

`StandaloneAgentManifest` is the filesystem document projection `{ identity, config }`. It is not
Config authority.

Provider configuration separates model binding from transport liveness. OpenAI-compatible endpoints
must explicitly declare `supportsReasoning` and `compatibility.supportsDeveloperRole`; neither value
is inferred from an endpoint label. Request, Actor invocation, Session compaction, response-start,
and stream-idle timeout values use `number | null`. `null` adds no Agent Base deadline while parent
cancellation remains effective.

Host-owned Step overrides and non-timeout Request limits are executable runtime wiring. They are not
stored in durable Config or `agent.json`. Credentials are resolved only while materializing runtime
or checking provider readiness; management and Session services never resolve them.
Standalone entry points validate this host-owned wiring before provisioning. Invalid limits,
Step overrides, or credential-reader shape therefore fail with `STANDALONE_CONFIG_INVALID` before
Identity/Config authority can be committed.

## Create and open

```ts
import { createStandaloneAgent } from '@ta-agent/base-standalone-agent';

const agent = await createStandaloneAgent(bootstrapConfig, {
  readEnvironmentVariable: (name) => process.env[name],
});

await agent.invoke('foreground', { message: 'hello' });
```

The result is a raw `StandaloneRawAgent`, not a facade. Callers can explicitly wrap it with
`createAgentAPI(agent)` from Composition. Provider inspection/readiness is a separate Service.

Bootstrap selects the canonical Memory or shared-SQLite profile, calls Agent Management `create()`,
then Runtime Service `open()`. Memory gets a fresh isolated scope on each bootstrap. SQLite stores
namespace publication and Identity/Config authority alongside Session/Journal state, with the same
host-level `sqlite` table-naming options (including authority and namespace domains) used by the
shared-SQLite profile. Creation conflicts on an existing Agent, including a disabled Agent; it never
replaces Config or implicitly performs create-or-open. Once authority is published, a subsequent
runtime-open failure does not undo it. Correct the host wiring or update/import authoritative Config,
then explicitly open again.

For a durable Agent, subsequent opens use only storage location and Agent ID:

```ts
import { createSharedSqliteStandaloneRuntimeService } from '@ta-agent/base-standalone-agent';

const runtime = createSharedSqliteStandaloneRuntimeService({
  databasePath: '/explicit/application/agent.sqlite',
  readEnvironmentVariable: (name) => process.env[name],
});
const reopened = await runtime.open('ordinary-agent');
```

Reuse the same host table-naming options if customized. Config is read from authority; use
management `updateConfig()` or `importConfig()` with an expected revision to change it. Updating
Config affects future opens, not already opened Agents. If sibling Services are needed for Memory,
retain one canonical Definition as below rather than using isolated bootstrap calls.

## Managed profiles

### Memory

`createStandaloneMemoryDefinition()` creates one isolated, ephemeral provisioning scope. Reuse its
Definition across sibling Services:

```ts
import {
  createAgentManagementService,
  createAgentRuntimeService,
  createSessionManagementService,
} from '@ta-agent/base-composition';
import {
  createStandaloneMemoryDefinition,
  defineStandaloneAgentConfig,
} from '@ta-agent/base-standalone-agent';

const definition = createStandaloneMemoryDefinition({
  readEnvironmentVariable: (name) => process.env[name],
});
const agents = createAgentManagementService(definition);
const runtimes = createAgentRuntimeService(definition);
const sessions = createSessionManagementService(definition);
const created = await agents.create({ identity, config: defineStandaloneAgentConfig(config) });
const agent = await runtimes.open(created.identity.identity.id);
const response = await agent.invoke('foreground', { message: 'hello' });
const history = await sessions.listTurns({
  agentId: created.identity.identity.id,
  sessionId: response.sessionId,
});
```

The private Profile Resource Provisioner allocates namespaces, lazily supplies Identity/Config
adapters, and lazily creates one complete coordinated Session/Request Journal/maintenance persistence
per published Agent namespace. Runtime and Session-management Ports project that same persistence,
including its queue and execution/recovery fences. New `open()` calls create fresh raw Agents, not
new Session authority. Config updates do not change persistence identity. Separate profile setups
never share state, even for identical Agent IDs; no module-global resources or runtime cache exist.

Staged Memory allocations are private and exclusively reserved until publication or abort. Failed
initialization discards the allocation and its authority; a retry starts fresh. Published authority
cannot be removed by a stale provisioning handle. There is no Config projection or crash durability.

There are deliberately no independent Memory management/runtime/Session convenience factories that
each silently create their own scope. Use the canonical Definition with narrow generic Services.
Advanced Definitions may explicitly share its factories: provisioning scope, not Definition object
reference identity, determines live resource sharing. Definition and Service construction creates
no per-Agent adapters; each capability obtains resources when needed. Session management does not
read Identity/Config or create a runtime, even for a disabled Agent.

### Durable profiles

The filesystem profile stores one Agent per directory:

```text
<root>/<agent-id>/agent.json
<root>/<agent-id>/agent.sqlite
```

`createStandaloneDirectoryDefinition()` returns a Session-capable
`ManagedAgentCompositionDefinition`. Namespace creation uses a hidden staging directory and atomic
rename. SQLite stores Identity and Config authority plus Session and Request Journal state.
`agent.json` is a one-way, secret-free Config projection repaired by management inspection.

`createSharedSqliteStandaloneDefinition()` stores multiple Agents in one explicit SQLite database.
Its pending/published namespace marker is the publication boundary. It installs no Config projection,
so management snapshots report `{ kind: 'not-configured' }`.

Both durable profiles expose narrow convenience factories:

```ts
import {
  createStandaloneDirectoryManagementService,
  createStandaloneDirectoryRuntimeService,
  createStandaloneDirectorySessionService,
} from '@ta-agent/base-standalone-agent';

const rootDirectory = '/explicit/application/agents';
const agents = createStandaloneDirectoryManagementService({ rootDirectory });
const runtime = createStandaloneDirectoryRuntimeService({
  rootDirectory,
  readEnvironmentVariable: (name) => process.env[name],
});
const sessions = createStandaloneDirectorySessionService({ rootDirectory });

const created = await agents.create({ identity, config });
const agent = await runtime.open(created.identity.identity.id);
const active = await sessions.list({ agentId: created.identity.identity.id, limit: 20 });
```

Equivalent `createSharedSqliteStandalone*Service()` factories select the shared database profile.
Their typed Port factories are the profile's provisioning boundary: they reopen scoped adapters
against stable database locations and table names, rather than maintaining an object cache. Two
Definitions configured for the same durable storage can therefore access the same authority.
Profile setup may explicitly prepare a host directory or SQLite namespace schema; this is not
eager per-Agent provisioning or materialization.
Management, runtime, and Session services are separate owners. Every runtime `open()` returns a new,
uncached raw Agent. Disabling an Agent blocks future opens but does not terminate an already opened
instance.

The Standalone Session factories return a host-facing `StandaloneSessionManagementService`. It uses
plain string identifiers and JSON-safe results while delegating lifecycle authority to the generic,
branded `SessionManagementService`. It exposes active/retired listing, lifecycle inspection, bounded
Turn queries, retire/restore, coordinated purge, and explicit execution recovery. Every call creates
only the scoped Session-management ports for the selected published Agent namespace; it does not
open an Agent runtime, resolve provider credentials, or require an active Agent identity. SQLite
bootstrap creates a published namespace accessible through the same shared-SQLite Services. Memory
consumers that need out-of-band management retain their canonical Definition/provisioning scope.

All SQLite construction paths accept a host-level `tablePrefix` plus per-domain `tableNames`
overrides. Names are resolved and collision-checked before storage initialization. They do not enter
Agent Config, Workflow, Steps, or `agent.json`.

## Provider readiness

`createStandaloneProviderService(config, options)` provides out-of-band inspection and credential
readiness for an authoritative Standalone Config. It is separate from the raw Agent returned by the
generic runtime service; provider diagnostics are application management concerns, not Agent
methods.

## Extension boundary

Applications with custom namespaces or resources can combine generic composition contracts with
`STANDALONE_AGENT_CONFIG_CODEC` and `materializeStandaloneAgentRuntime()`. The materializer accepts
`{ identity, config, ports, options }`; namespace handles must first be projected into typed runtime
ports. Both Session and Request Journal are required, even for Memory. The materializer does not
allocate persistence or create a facade. Advanced mixed persistence and implicit Memory defaults
remain available at the lower `composeAgent()` boundary, not the official Standalone materializer.
This keeps storage policy outside Agent construction while preserving the exact raw Agent type.
