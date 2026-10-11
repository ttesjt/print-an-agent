# Local Agent Web host

```sh
pnpm --filter @ta-agent/ui-agent-web build
pnpm --filter @ta-agent/ui-agent-web serve --root /absolute/path/to/agents --port 4174
```

Open `http://127.0.0.1:4174`. `--root` selects the multi-Agent workspace. Each Agent keeps its
own Identity, typed configuration and Session/Journal database. The CLI chooses root/port only;
there is no global provider file and no implicit deterministic fallback.

To select the Collection in the browser instead, omit `--root`:

```sh
pnpm --filter @ta-agent/ui-agent-web serve --port 4174
```

Enter an absolute host directory or browse folders. Opening creates a missing directory. The
header's **Collections** action returns to selection; active work must finish or be cancelled, and
unsaved edits/drafts require explicit discard. Recent entries are convenient browser references,
not resource ownership. Forgetting or clearing them never deletes an Agent. See
[Collection routing and binding](./collections.md).

Create an Agent, choose its model connection and save. Builtin provider/model names use the
installed provider catalog; catalog capabilities are not redeclared. OpenAI-compatible endpoints
require an explicit provider/model, HTTP(S) base URL, context/output capabilities, reasoning
capability and developer-role compatibility. A local endpoint may support reasoning but still
require system instructions. Keyless local endpoints need no credential binding.

For authenticated endpoints, enable a server credential and enter a reference plus environment
variable name, for example `research-cloud` and `RESEARCH_API_KEY`. Export the actual key in the
host process environment before starting it. The application persists only that reference/name.
The host-owned resolver obtains the value at invocation. Do not use browser-visible `VITE_*`
variables. Raw keys are not accepted by the UI/schema or written into Agent files, configuration,
browser storage, stream events or error responses.

Actor instructions, temperature and invocation output limit are distinct from model capabilities.
Advanced Request, Actor, provider response-start and event-idle deadlines accept positive
milliseconds; an empty field means `null`, no local deadline. Caller cancellation remains active.
All deadlines default to `null`. Config changes apply to newly materialized calls, not active calls.

Saving or inspecting configuration never invokes a model. Availability checks validate saved
configuration and credential availability, not network connectivity. **Test saved connection** is
explicit: it sends a small model request, capped at 16 output tokens and 30 seconds (or the
configured shorter Actor limit). It can be cancelled, may incur a charge, and creates no Session
or Request Journal record. Success is tied to the tested config revision; changes invalidate it.

For development, keep the host running and start `pnpm --filter @ta-agent/ui-agent-web dev` in a
second terminal. Vite at port `5173` proxies `/api` to the host. Production `serve` serves
`dist/public` and the API on one origin; `vite preview` alone has no backend. Explicit browser
fixtures use `?mode=deterministic` and identify themselves as demonstrations.

## Transport and deployment boundaries

- Commands and stream frames use closed schemas on both sides. Unknown fields and malformed
  responses do not become application state. Body, response, frame and stream sizes are bounded.
- Ordered NDJSON retains interaction identity, model-turn reasoning, safe tool presentation and
  backpressure. Aborting provides cancellation to paths that support it; non-cancellable commit
  I/O can still finish, so interrupted callers must reconcile authoritative history.
- The host binds `127.0.0.1`, checks Host/Origin and permits no wildcard CORS. This is a trusted
  local-machine application, not a remote authenticated multi-user deployment. Arbitrary endpoint
  URLs and server environment bindings are appropriate only for that trust model. A remote host
  must add authorization, endpoint/environment allowlists, quotas and deployment policy.
- Shutdown cancels and drains cooperative work. Arbitrary Engines that ignore cancellation cannot
  be forcibly stopped. Browser unmount cancels owned streams; durable reconnect is not claimed.
- No old configuration compatibility or migration is provided. Existing development data is not
  deleted automatically; use a fresh root for the current schema.
