# `@ta-agent/base-cli`

The thin standalone command-line composition for Agent Base. It can read one explicit closed JSON
runtime configuration or open a managed Agent by explicit `--root` and `--agent-id`. All lifecycle,
filesystem, SQLite, and Agent behavior remains delegated to `@ta-agent/base-standalone-agent`.

The CLI exposes Agent create/list/inspect/disable/reactivate, provider readiness, one-shot or stdin
request execution, Session compaction, and Session inspect/select/fork/rewind. Request text streams
to stdout; metadata commands emit one JSON line. Lifecycle output is a safe projection containing
IDs, display name, statuses, and revisions—not provider configuration or credentials. Error output
contains stable codes rather than paths, provider, credential, prompt, or response data.

Memory and SQLite remain explicit direct-config profiles. Managed mode derives the per-Agent SQLite
path only after the operator explicitly supplies a root and validated Agent ID. The CLI does not
choose a default storage location, load YAML, infer credentials, install tools from configuration,
or invoke a local model.

Example configuration:

```json
{
  "schemaVersion": 1,
  "identity": { "id": "ordinary-agent" },
  "provider": {
    "kind": "openai-compatible",
    "reference": {
      "provider": "local-openai",
      "model": "served-model",
      "baseUrl": "http://127.0.0.1:8000/v1"
    },
    "contextWindowTokens": 8192,
    "maxOutputTokens": 1024
  },
  "persistence": {
    "kind": "sqlite",
    "databasePath": "/absolute/path/to/agent.sqlite"
  }
}
```

Run `agent-base --help` for the exact command surface. A provider that declares `credentialRef`
also requires a matching top-level credential binding such as
`{"reference":"credentials/agent","environmentVariable":"AGENT_API_KEY"}`; the environment
value itself is resolved only at runtime.
