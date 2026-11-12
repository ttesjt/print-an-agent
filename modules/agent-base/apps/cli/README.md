# `@print-an-agent/base-cli`

The thin standalone command-line delivery for Agent Base. It can bootstrap an ephemeral Memory
Agent from closed JSON, or open authoritative stored configuration by `--agent-id` and either
`--root` (per-Agent directory) or `--database-path` (shared SQLite). All lifecycle,
filesystem, SQLite, and Agent behavior remains delegated to `@print-an-agent/base-standalone-agent`.

The CLI exposes Agent create/list/inspect/disable/reactivate, provider readiness, one-shot or stdin
request execution, the Session compaction runtime Operation, out-of-band Session
inspect/select/fork/rewind, and separate Session lifecycle commands. Request text streams to stdout;
metadata commands emit one JSON line. Lifecycle output is a safe projection containing IDs, display
name, statuses, and revisions—not provider configuration or credentials. Error output contains
stable codes rather than paths, provider, credential, prompt, or response data.

Agent creation and runtime opening use the official profile Definition, provisioning and narrow
Services. Provider checks use only the narrow provider Service: `--config` performs a preflight of
the supplied Memory configuration without creating an Agent, while stored locators read Config
authority. Directory mode
derives the per-Agent SQLite path only after the operator supplies a root and validated Agent ID.
Shared-SQLite mode uses the explicit absolute database path. The CLI does not
choose a default storage location, load YAML, infer credentials, install tools from configuration,
or invoke a local model.

Example ephemeral Memory bootstrap (`run --config memory.json --message hello`):

```json
{
  "schemaVersion": 1,
  "identity": { "id": "ordinary-agent" },
  "provider": {
    "config": {
      "kind": "openai-compatible",
      "reference": {
        "provider": "local-openai",
        "model": "served-model",
        "baseUrl": "http://127.0.0.1:8000/v1"
      },
      "contextWindowTokens": 8192,
      "maxOutputTokens": 1024,
      "supportsReasoning": false,
      "compatibility": { "supportsDeveloperRole": false }
    },
    "transportLivenessPolicy": {
      "responseStartTimeoutMilliseconds": null,
      "streamEventIdleTimeoutMilliseconds": null
    }
  },
  "mainActor": { "invocationPolicy": { "timeoutMilliseconds": null } },
  "request": { "timeoutMilliseconds": null },
  "sessionCompaction": { "timeoutMilliseconds": null },
  "persistence": { "kind": "memory" }
}
```

For durable use, create explicitly from a manifest, then open by storage location:

```text
agent-base agent create --database-path /absolute/path/to/agents.sqlite --manifest initialize.json
agent-base provider check --database-path /absolute/path/to/agents.sqlite --agent-id ordinary-agent
agent-base run --database-path /absolute/path/to/agents.sqlite --agent-id ordinary-agent --message hello
```

The creation manifest has `{ schemaVersion: 1, identity, config }`: `config` contains the provider,
optional credential, mainActor, request and sessionCompaction sections above, without `persistence`
or `identity`. The storage location is selected explicitly by the command. Substitute `--root <dir>`
for `--database-path <file>` to use the directory profile. Agent list/inspect/disable/reactivate also
accept either storage locator.

Duplicate creation returns `MANAGED_AGENT_ALREADY_EXISTS`; opening an unknown Agent does not create
it. Neither run nor provider-check reads the initialization manifest again. Config updates/imports
use the Standalone management API with revision checks; editing a manifest or `agent.json` projection
does not update authority. `--config` rejects SQLite bootstrap documents before any provisioning or
provider work. It is not a durable open or implicit Config overwrite shortcut.

Run `agent-base --help` for the exact command surface. A provider that declares `credentialRef`
also requires a matching top-level credential binding such as
`{"reference":"credentials/agent","environmentVariable":"AGENT_API_KEY"}`; the environment
value itself is resolved only at runtime.

The timeout layers are authoritative Agent configuration. `null` means that Agent Base installs no
automatic deadline at that layer; positive integers are milliseconds. The CLI provides no flags or
environment overrides for these values. Runtime opening reads stored Config from the selected
profile; Memory bootstrap initializes ephemeral authority from its explicit input.

Memory `--config` always creates a new process-local Session, so it rejects `--session-id` and
`--idempotency-key`. Durable `--root` and `--database-path` runs may omit `--session-id` to create
a new Session. When its response stream opens, the CLI emits one
`{"type":"session-created","sessionId":"..."}` metadata line to stderr; assistant text remains
on stdout. Use that returned ID with `--session-id` to continue a durable Session. An unknown ID
fails rather than creating a named Session. `--idempotency-key` requires an existing durable
Session ID. Session compact/inspect/select/fork/rewind likewise require a durable locator. Compaction
opens a runtime because it may invoke an Actor; navigation loads only the narrow Session Navigation
Service. Memory Sessions remain process-local and cannot be reopened by another CLI process.

Session lifecycle management is available only for the managed directory profile:

```text
agent-base session lifecycle list|list-retired --root <dir> --agent-id <id> ...
agent-base session lifecycle inspect|turns --root <dir> --agent-id <id> --session-id <id> ...
agent-base session lifecycle retire|restore --root <dir> --agent-id <id> --session-id <id> ...
agent-base session lifecycle purge --root <dir> --agent-id <id> --session-id <id> ... --confirm-permanent-delete
agent-base session lifecycle recover --root <dir> --agent-id <id> --session-id <id> ...
```

These commands load the narrow Standalone Session management projection. They work for disabled
Agents and do not open a raw Agent runtime or initialize provider state. Purge requires the explicit
boolean confirmation flag. The lifecycle CLI currently accepts only directory locators; this is a
delivery boundary, not a lack of namespace or Session capability in other profiles. Shared-SQLite
Services expose the same management capabilities, and Memory hosts can retain their canonical
Definition to share resources with Session management. `--config` is process-local bootstrap input,
not a reusable locator for these out-of-band commands.

The embeddable command runner uses `loadAgentManager(storage)` for Agent lifecycle, `loadRuntime()`
for runtime Operations, `loadSessionNavigator()` for out-of-band navigation, and `loadProvider()`
for diagnostics. Node host loaders remain internal.
