# `@ta-agent/base-cli`

The thin standalone command-line composition for Agent Base. It reads one closed, versioned JSON
configuration, resolves an optional credential reference from one named environment variable, and
delegates all Agent behavior to `@ta-agent/base-standalone-agent`.

The CLI exposes provider readiness, one-shot or stdin request execution, Session compaction, and
Session inspect/select/fork/rewind. Request text streams to stdout; metadata commands emit one JSON
line. Error output contains stable codes rather than provider, credential, prompt, or response data.

Memory and SQLite are explicit persistence profiles. Memory is process-local. SQLite requires an
absolute database path and provides restart-safe Session and Request Journal state. The CLI does not
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
