# Local Agent Web host

Build the application, then start the loopback-only Node host:

```sh
pnpm --filter @ta-agent/ui-agent-web build
pnpm --filter @ta-agent/ui-agent-web serve --root /absolute/path/to/agents
```

The default port is `4174` (`--port` overrides it). The default Engine is explicitly offline and
labels its responses accordingly; no key, local model or public network is required. It still runs
the real Agent Base composition, SQLite authority and Session/Journal persistence. The browser
composition consumes these ports in the application, not in reusable components.

To use an ordinary provider, add `--provider /absolute/path/to/host.json`:

```json
{
  "config": {
    "kind": "openai-compatible",
    "reference": {
      "provider": "local",
      "model": "your-model",
      "baseUrl": "http://127.0.0.1:11434/v1"
    },
    "contextWindowTokens": 4096,
    "maxOutputTokens": 1024,
    "supportsReasoning": false,
    "compatibility": { "supportsDeveloperRole": false }
  },
  "transportLivenessPolicy": {
    "responseStartTimeoutMilliseconds": null,
    "streamEventIdleTimeoutMilliseconds": null
  }
}
```

This example does not claim that a particular model implements these limits/capabilities. Supply
the values for your endpoint. Builtin provider config is also accepted through the public provider
factory. For authenticated providers, `reference.credentialRef` names a server environment variable
(for example `AGENT_WEB_API_KEY`); the key is never placed in the file, Agent config, browser bundle,
events or error responses. Do not use a browser-visible `VITE_*` variable for credentials.

Host provider provisioning and application-editable instructions/response-style config are separate
authorities. Updating Agent config affects subsequent materialization, not a running interaction.
The host accepts no provider fields from UI requests. No automatic Request/Actor/transport deadline
is added by the app; cancellation is cooperative and commit ambiguity requires history reconciliation.

For development, keep the host running and start `pnpm --filter @ta-agent/ui-agent-web dev` in a
second terminal. Vite at port `5173` proxies `/api` to the host. Production `serve` serves
`dist/public` and the API on one origin; `vite preview` alone has no backend.

## Transport and deployment boundaries

- Commands are closed, typed application RPCs. Both server input/output and client responses are
  decoded; unknown fields, accessors, unsupported operations and malformed events are rejected.
- NDJSON stream events retain interaction identity, model-turn boundaries, order, backpressure and
  one terminal state. Closing/aborting the request cancels Engine/tool work where supported.
- Body, response, event frame and total stream sizes are bounded. Body/frame errors are sanitized,
  with no storage paths, provider payloads or exception messages exposed.
- The server binds only `127.0.0.1`; Host and browser Origin are checked. There is no wildcard CORS.
  CLI clients may omit Origin. Only explicit same-machine dev origins are trusted.
- This is a trusted local-machine reference host, not an authenticated remote multi-user service.
  A remote deployment needs its own authentication, authorization, resource quotas and transport
  policy. These concerns must not be smuggled into reusable components.
- Shutdown aborts active requests and drains cooperative work. It cannot forcibly stop arbitrary
  custom Engines that ignore cancellation. No durable background-run recovery or reconnect protocol
  is claimed. Browser unmount cancels its owned streams.

See [backend-boundary.md](./backend-boundary.md) for history/tool-persistence/idempotency limits.
