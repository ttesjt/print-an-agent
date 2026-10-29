# `@ta-agent/base-standalone-agent`

The official Standalone application profile for Agent Base.

Optional Context/Retrieval provisioning and the Context management Service are described in
[Memory management](./MEMORY.md).

This package owns Standalone policy: stored Config vocabulary, provider and credential wiring,
timeout policy, SQLite table naming, Memory/filesystem/shared-SQLite profiles, `agent.json` projection, and
the Standard runtime materializer. Generic Agent lifecycle, runtime opening, out-of-band Session
management, and Session navigation belong to `@ta-agent/base-composition`; Standalone consumes those
services rather than reimplementing them.

## Config vocabulary

`StandaloneAgentConfig` is the authoritative managed Config. It contains provider, credential binding,
main Actor, Request, and Session compaction policy. `STANDALONE_AGENT_CONFIG_CODEC` is its canonical
Config authority codec. Memory keeps revisioned authority for the lifetime of its profile scope;
filesystem and shared-SQLite profiles persist it across processes.

`StandaloneAgentBootstrapConfig` adds Identity and a Memory or explicit SQLite persistence choice.
`defineStandaloneAgentBootstrapConfig()` validates it for host loaders. Asynchronous
`createStandaloneAgent(setup, { identity, config })` initializes authority and opens one Agent through
the caller-owned setup and narrow Services; persistence is chosen by setup, not by this helper.
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

`sessionCompaction` stores the complete normalized token policy: source limits, `maxContextTokens`,
`target`, `maxGenerationAttempts`, `maxGenerationCharacters`, `retrySafetyFactor`,
`minimumTargetTokens`, and `timeoutMilliseconds`. Input may omit non-timeout fields to use official
defaults; an explicitly provided section must declare its timeout. Runtime host wiring cannot
silently override this durable policy. Per-call `target` parameters may request tighter goals without
mutating Config or relaxing its hard token limit.

Measurement is declared beside the provider binding, separately from provider wire configuration:

```json
{
  "provider": {
    "config": {
      "kind": "builtin",
      "reference": { "provider": "openai", "model": "gpt-4o", "credentialRef": "credentials/main" }
    },
    "textTokenCounter": { "kind": "tiktoken", "encoding": "o200k_base" }
  },
  "credential": { "reference": "credentials/main", "environmentVariable": "AGENT_API_KEY" }
}
```

`provider.textTokenCounter` is optional. It accepts `tiktoken` with explicit `cl100k_base`/`o200k_base`,
`character-estimator` with optional `charactersPerToken` (default 4), or
`reference` with a complete `measurementRef`. Named references require a synchronous, preloaded host
`resolveTextTokenCounter(ref)` lookup in runtime options. JSON never loads arbitrary code.
Counter selection survives Config codec, manifest projection, import/CAS and runtime reopen;
`createStandaloneProviderService().inspect().textTokenCounter` exposes its non-secret descriptor.
Config/inspection identity changes when counting behavior changes. No provider catalog capability,
tokenizer-model mapping or accuracy is inferred. Exact text counting is not whole-request counting.

Each materialization resolves this declaration into the provider Engine's optional `textTokenCounter`;
the main Actor inherits it, and compaction follows the foreground consumer's binding. Estimated
measurements may be useful for reporting but cannot satisfy compaction's hard token acceptance.
`sessionCompactionTokenCounter: TokenCounter<TextTokenInput>` remains an explicit host-only compaction
override, never serialized. Without either binding, foreground interaction still works and eligible
compaction fails with `SESSION_COMPACTION_TOKENIZER_NOT_CONFIGURED`.

## Create and open

```ts
import {
  createStandaloneAgent,
  createStandaloneMemorySetup,
} from '@ta-agent/base-standalone-agent';

const setup = createStandaloneMemorySetup({
  readEnvironmentVariable: (name) => process.env[name],
});
const agent = await createStandaloneAgent(setup, { identity, config });

await agent.invoke('foreground', { message: 'hello' });
await setup.close(); // after all business calls and their cancellation cleanup have settled
```

The result is a raw `StandaloneRawAgent`, not a facade. Callers can explicitly wrap it with
`createAgentAPI(agent)` from Composition. Provider inspection/readiness is a separate Service.

The caller selects `createStandaloneMemorySetup`, `createStandaloneDirectorySetup`, or
`createSharedSqliteStandaloneSetup`, retaining its explicit `close()` owner even if creation/opening
fails. The convenience helper calls Agent Management `create()`, then Runtime Service `open()`;
it never hides another setup on the returned Agent. Memory gets an isolated namespace per setup.
SQLite stores
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
Config affects future opens, not already opened Agents. Mutation methods return committed Identity
and Config authority separately from the optional manifest Projection outcome. A stale or failed
manifest Projection does not roll back authority; callers can inspect or reconcile it later. Every
management method accepts optional `{ signal }` execution options. Cancellation can stop work before
the authoritative adapter boundary, but it cannot relabel a mutation after that boundary has begun.
If sibling Services are needed for Memory, retain one setup and use its canonical Definition below.

## Managed profiles

### Memory

`createStandaloneMemorySetup()` creates one isolated, ephemeral Profile owner. Retain it and reuse
its Definition across sibling Services:

```ts
import {
  createAgentManagementService,
  createAgentRuntimeService,
  createSessionManagementService,
  createSessionNavigationService,
} from '@ta-agent/base-composition';
import {
  createStandaloneMemorySetup,
  defineStandaloneAgentConfig,
} from '@ta-agent/base-standalone-agent';

const setup = createStandaloneMemorySetup({
  readEnvironmentVariable: (name) => process.env[name],
});
const definition = setup.definition;
const agents = createAgentManagementService(definition);
const runtimes = createAgentRuntimeService(definition);
const sessions = createSessionManagementService(definition);
const navigation = createSessionNavigationService(definition);
const created = await agents.create({ identity, config: defineStandaloneAgentConfig(config) });
const agent = await runtimes.open(created.authority.identity.identity.id);
const response = await agent.invoke('foreground', { message: 'hello' });
const history = await sessions.listTurns({
  agentId: created.authority.identity.identity.id,
  sessionId: response.sessionId,
});
await setup.close();
```

The private Profile Resource Provisioner compiles one resource Blueprint per setup, without I/O.
Each namespace stage reserves an opaque allocation and its Scope, then prepares Identity/Config
authority through that Blueprint **before returning the stage handle**. The synchronous authority
factory supplies those prepared Ports; it does not construct adapters or own another cache. Session
persistence remains lazy: one complete coordinated Session/Request Journal/maintenance acquisition
per published Agent namespace. Runtime, Session-management, and Session-navigation Ports
project that same persistence, including its queue and execution/recovery fences. New `open()` calls
create fresh raw Agents, not new Session authority. Config updates do not change persistence
identity. Separate profile setups never share state, even for identical Agent IDs; no module-global
resources or runtime cache exist.

Staged Memory allocations have distinct opaque tokens and internal allocation IDs. They are private
and exclusively reserved until publication or confirmed abort cleanup. Every allocation owns a Scope
from the same setup-owned Blueprint; publish keeps that Scope, rather than rebuilding or transferring
it. Successful abort permits a fresh allocation; an unconfirmed cleanup retains its reservation and
failure for setup shutdown. Stage initialization failure is unwound by the Profile itself, including
failure before any handle reaches the caller. Such failed allocations remain owned until confirmed
cleanup; setup shutdown joins all allocations, not just published namespaces. Published authority
cannot be removed by a stale provisioning handle. There is no Config projection or crash durability.

There are deliberately no independent Memory management/runtime/Session convenience factories that
each silently create their own scope. Use the canonical Definition with narrow generic Services;
`projectStandaloneSessionNavigationService()` adds a plain-string host boundary when needed.
Advanced Definitions may explicitly share its factories: provisioning scope, not Definition object
reference identity, determines live resource sharing. Definition and Service construction creates
no per-Agent adapters; each capability obtains resources when needed. Session management does not
read Identity/Config or create a runtime, even for a disabled Agent.

Setup is a lifetime handle, not an eager Application or a business executor. Host shutdown must stop
admission and cancel/join business calls before `setup.close()`. Its `mode: 'abort'` only cancels
resource initialization. Preserve operation results and cleanup failures separately; never label a
committed mutation uncommitted because cleanup later failed. Repeated close joins the same result and
can escalate initialization drain to abort.

The defaults are the real Memory Identity/Config and coordinated Session adapters. Optional
`acquireAuthority({ agentId, allocationId, signal })` and
`acquireSessionPersistence({ agentId, allocationId, signal })` are Profile recipes fixed at setup
construction; each returns `{ value, release? }` for one allocation. Authority acquisition runs
during stage, before generic management initializes or publishes authority; Session acquisition runs
only on first published usage. Their signals belong to Scope initialization, not the first business
caller. These are not per-Run overrides or Registry access. The provider must unwind partial
initialization before throwing; an unconfirmed
unwind must throw `ResourceCleanupError`. Scope closes only explicitly owned acquisitions, never
guesses ownership from an object's `close` method. Reopenable durable adapters still open and close
connections per operation; their setup wrappers gate future admission without deleting durable data.

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
  createStandaloneDirectorySessionNavigationService,
  createStandaloneDirectorySessionService,
} from '@ta-agent/base-standalone-agent';

const rootDirectory = '/explicit/application/agents';
const agents = createStandaloneDirectoryManagementService({ rootDirectory });
const runtime = createStandaloneDirectoryRuntimeService({
  rootDirectory,
  readEnvironmentVariable: (name) => process.env[name],
});
const sessions = createStandaloneDirectorySessionService({ rootDirectory });
const navigation = createStandaloneDirectorySessionNavigationService({ rootDirectory });

const created = await agents.create({ identity, config });
const agent = await runtime.open(created.authority.identity.identity.id);
const active = await sessions.list({
  agentId: created.authority.identity.identity.id,
  limit: 20,
});
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
Every method accepts optional `{ signal }` execution options. Cancellation is rechecked after
namespace and Port preparation and immediately before the final Port call; once that call starts,
the Service waits for the real lifecycle or maintenance result.

The independent Standalone navigation factories expose plain-string `inspect`, `select`, `fork`, and
non-destructive `rewind` inputs while delegating validation, execution admission, CAS, cancellation,
and cleanup to the generic `SessionNavigationService`. They reopen only scoped Session persistence;
they do not open a raw Agent or resolve runtime credentials. Directory and shared-SQLite factories
can be recreated from stable storage location and table naming. Memory consumers retain one
Definition so runtime, lifecycle, and navigation Services share the same ephemeral provisioner.

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
