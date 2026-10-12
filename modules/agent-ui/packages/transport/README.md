# Optional Workspace Transport

This package shares the closed, validated HTTP/NDJSON protocol, not an application server or backend.
Direct `WorkspacePorts` consumers do not need it. Neither `ui-react` nor `ui-workspace` depends on it.

- The package root exports codecs, the closed workspace command vocabulary and capability projection.
- `/browser` exports `createHttpWorkspacePorts` and the lower-level `createHttpTransport` for product commands.
- `/node` exports request decoding, command dispatch and backpressured response writing. It never listens,
  selects a Collection, resolves credentials or owns backend resources.

`createHttpWorkspacePorts({ baseUrl, capabilities })` installs only explicitly advertised optional
mutations; the default is read/interaction capabilities only. Supply the finite capability object
from a trusted composition or decode a host advertisement with `workspaceCapabilitiesDecoder`.
Capabilities are not authorization: the host must authenticate/authorize each request.

The host binds `POST /commands` and `POST /interactions`, wires disconnect cancellation, handles
errors and destroys any already-started response on protocol failure. `dispatchWorkspaceCommand`
rejects unknown commands and absent capabilities. Body/frame/response limits and closed schemas
apply on both sides. `/browser` has no Node or React dependency. Product commands can use their own
codecs through `createHttpTransport`; product schemas are never added to the shared vocabulary.

Stream callbacks are backpressured. Terminal frames remain provisional until clean EOF and full
validation; trailing events cannot publish success. A `committed` receipt is a terminal outcome,
not a completed presentation. Host commit knowledge must never be inferred from socket cancellation.
For product mutations, use explicit durable outcomes and reconcile unknown transport results before retry.
