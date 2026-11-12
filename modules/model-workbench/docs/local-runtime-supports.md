# Local Runtime Supports

`@print-an-agent/workbench-local-runtime` supplies default filesystem-backed implementations of the two
Runtime Support SPIs. It does not implement or start a model operation. Initializer, Trainer,
Exporter, and Output Invoker Capabilities remain the only model-operation entry points.

Both local protocols are scoped by the `profileId` that Workbench passes to every extension call.
Equal backend receipts in different Profiles therefore resolve to different filesystem locations.

## Directory Artifact handoff

The local Artifact Support accepts the closed receipt:

```ts
{
  kind: 'local-directory';
  relativePath: string;
}
```

It resolves that receipt beneath:

```text
<rootDirectory>/<profileId>/artifacts/<relativePath>
```

The relative path cannot escape its Profile root. Artifact directories must contain at least one
regular file and cannot contain symbolic links or special filesystem entries. Verification computes
a deterministic SHA-256 digest with this canonical protocol:

1. Convert relative path separators to `/`, normalize each complete path to Unicode NFC, and reject
   paths that collide after normalization.
2. Sort complete normalized paths by unsigned UTF-8 bytes, independent of process locale.
3. For each file, hash `file\\0`, the UTF-8 path byte length, `\\0`, the path, `\\0`, the decimal
   file byte length, `\\0`, and then the file bytes.
4. Stream file content through a fixed-size buffer and reject a file that changes while it is being
   hashed.

Materialization returns a transient, read-only local-directory binding; durable model assets retain
only the digest and receipt.

`deriveLocalDirectoryArtifactDigest()` exposes the exact digest algorithm for a TypeScript
Capability bridge. A backend in another language must implement the same bounded protocol or let its
bridge calculate the digest before returning the Capability terminal result.

## Detached local execution

The local Execution Support accepts the closed receipt:

```ts
{
  kind: 'local-filesystem-execution';
  executionId: string;
}
```

It resolves that receipt beneath:

```text
<rootDirectory>/<profileId>/executions/<executionId>/
```

`observe()` opens `observation.json` without following links and in non-blocking mode, confirms that
it is a regular file, and enforces the byte limit while reading rather than trusting one earlier file
size. The JSON contains the fixed Workbench `ExecutionObservation` envelope. The Support does not
infer a success, failure, or lost result from process existence. A missing, oversized, or corrupt
record is an observation infrastructure error, because inventing a terminal result could incorrectly
accept model assets.

`cancel()` atomically and idempotently creates `cancellation-requested`. Cancellation remains a
request: the local execution supervisor owns responding to that marker, stopping its backend, and
atomically publishing the resulting cancelled terminal observation.

## Local command bridge and supervisor

`createLocalCommandBridge()` adapts an arbitrary executable into the callable function used by a
Model Capability. It takes an absolute executable, an argument vector, an optional working
directory, and optional environment values. It never invokes a shell. The bridge is not a new
Capability or Runtime Support: the Capability remains the model-operation driver, while the bridge
provides one default local execution topology.

The bridge derives a stable execution identity from `profileId + runId`, atomically creates the
execution workspace, starts a detached per-execution supervisor, and returns the existing local
execution receipt. Repeating the same request and command returns the same receipt without starting
another backend. Reusing that identity with a different request or command is rejected.

The backend protocol is language-neutral:

1. The supervisor writes exactly one JSON Capability request to backend stdin.
2. Backend stdout is bounded JSON Lines. A line is either a progress message or the single terminal
   `ExecutionTerminal`:

   ```json
   { "kind": "progress", "progress": { "step": 2 } }
   { "kind": "terminal", "terminal": { "status": "succeeded", "result": {} } }
   ```

3. Stderr is consumed continuously and only a bounded prefix is retained in `stderr.log`.
4. The supervisor atomically publishes every accepted observation to `observation.json`.
5. It polls the durable cancellation marker, first requests graceful termination, and escalates to
   forced termination after the configured grace period.

The terminal `result` is still operation-specific and is validated by the selected Model
Capability contract when Workbench refreshes the Run. The supervisor only validates the fixed
system envelope. A malformed stream, missing terminal result, or contradictory successful result
and non-zero exit becomes a structured execution failure.

By default, the bridge freezes the effective inherited process environment when the bridge is
created, applies explicit `command.environment` overrides, includes that complete snapshot in the
command digest, and passes exactly that snapshot to the supervisor. Set `inheritEnvironment: false`
to use only explicit values. Environment plaintext is not persisted to the workspace. The persisted
launch record contains only the digest, which detects command or environment drift on idempotent
redispatch.

Supervisor ownership records contain both a random process incarnation and a renewed heartbeat.
Redispatch accepts an existing owner only while its PID is alive and its heartbeat lease is fresh;
PID reuse therefore cannot leave an execution permanently running. The current default remains a
per-execution process, not a daemon or distributed scheduler. Machine reboot recovery and a general
log-query product API remain outside this local runtime boundary.

An integration fixture uses Python's standard library to prove that no TypeScript- or
Python-specific wire protocol is hidden in this design. Installing the Workbench packages does not
add Python as a runtime dependency; Python is only needed to execute that cross-language fixture.

## Local Output Invocation bridge

`createLocalOutputInvocationBridge()` is the default process bridge for invocation-scoped Output
Invoker Capabilities. Unlike the detached command bridge, it keeps one child process attached to
one invocation and creates no Run or execution workspace. It sends the materialized Output request
as one JSON document on stdin. Stdout uses bounded JSON Lines and must start with exactly one of:

```json
{ "kind": "completed", "result": {} }
{ "kind": "stream-start" }
```

A streaming invocation then emits zero or more chunk messages:

```json
{ "kind": "chunk", "result": {} }
```

EOF plus exit code zero completes the stream. Invalid messages, a non-zero exit, or a protocol-size
violation fail the invocation. The bridge forwards cancellation for the entire stream lifetime and
terminates the child if the consumer stops iteration early. Stderr is continuously consumed while
only a bounded prefix is retained for diagnostics.

Early iterator return terminates the child even before its first chunk is requested. Shutdown
starts process termination and reader closure before awaiting either, avoiding blocked reads or
paused-stdout close cycles. Repeated close shares one cleanup result; failed invocation handshakes
use the same process/reader cleanup boundary.
