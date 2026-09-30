# `@ta-agent/base-standalone-agent`

The official Standalone application profile for Agent Base.

This package owns Standalone policy: durable Config vocabulary, provider and credential wiring,
timeout policy, SQLite table naming, filesystem/shared-SQLite profiles, `agent.json` projection, and
the Standard runtime materializer. Generic Agent lifecycle, runtime opening, and out-of-band Session
management belong to `@ta-agent/base-composition`; Standalone consumes those services rather than
reimplementing them.

## Config vocabulary

`StandaloneAgentConfig` is the durable managed Config. It contains provider, credential binding,
main Actor, Request, and Session compaction policy. `STANDALONE_AGENT_CONFIG_CODEC` is its canonical
Config authority codec.

`StandaloneAgentBootstrapConfig` adds Identity and a Memory or explicit SQLite persistence choice.
`defineStandaloneAgentBootstrapConfig()` and `createStandaloneAgent()` use it to start one Agent
directly, without the multi-Agent management plane.

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

## Direct bootstrap

```ts
import { createStandaloneAgent } from '@ta-agent/base-standalone-agent';

const api = createStandaloneAgent(bootstrapConfig, {
  readEnvironmentVariable: (name) => process.env[name],
});

await api.run({ message: 'hello' });
```

The returned `ProviderAgentAPI` is a convenience facade and exposes its raw `agent`. Direct Memory
and SQLite bootstrap share the same Standard runtime materialization core used by managed profiles.

## Managed profiles

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

Both profiles expose narrow convenience factories:

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
Management, runtime, and Session services are separate owners. Every runtime `open()` returns a new,
uncached raw Agent. Disabling an Agent blocks future opens but does not terminate an already opened
instance.

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
only `{ identity, config, ports }`; namespace handles must first be projected into typed runtime
ports. Omit `ports` for the complete default Memory profile, or provide both Session and Request
Journal ports as one profile; advanced mixed persistence belongs at the lower Composition boundary.
This keeps storage policy outside Agent construction while preserving the exact raw Agent type.
