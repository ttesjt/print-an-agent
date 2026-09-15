# Model Workbench Python backend

Runnable reference backend for Model Workbench. It implements a deliberately tiny character-level
causal Transformer while keeping the Workbench protocol independent from the model framework.

The command accepts exactly one JSON request on stdin and writes only the Workbench JSON Lines
protocol to stdout:

```console
ta-agent-model-backend initialize
ta-agent-model-backend train
ta-agent-model-backend export
ta-agent-model-backend invoke
```

Install the optional model runtime before using those commands:

```console
uv sync --extra transformer
```

From this Python project directory, use two explicit verification layers:

```console
uv sync
uv run ruff format --check .
uv run ruff check .
uv run mypy
uv run pytest tests/architecture tests/unit tests/protocol
uv build

uv sync --extra transformer
uv run --extra transformer pytest tests/model tests/integration
```

The first layer is framework-free. The second requires PyTorch and never treats a missing model
runtime as a successful skip. A host repository should add its own Workbench lifecycle smoke using
the matching Workbench-side definition.

Tests are organized by responsibility under `tests/architecture`, `tests/unit`, `tests/protocol`,
`tests/model`, and `tests/integration`. Model-specific repositories should preserve these boundaries
so protocol failures remain cheap to diagnose while real framework behavior stays mandatory in the
focused qualification gate. See [`tests/README.md`](tests/README.md) for the reusable qualification
contract.

The package does not select a platform-specific PyTorch distribution. A deployment may instead
install the appropriate CPU, CUDA, or MPS build through its own Python environment. Protocol-only
imports and fake-handler qualification do not import PyTorch.

The source ownership and dependency rules are documented in
[`docs/architecture.md`](docs/architecture.md).
The supported experiment change points and Contract synchronization workflow are documented in
[`docs/customizing.md`](docs/customizing.md).

`model-backend.template.json` is the machine-readable source descriptor consumed by the repository's
backend Scaffold CLI. It defines copy roots, generated identity tokens, exclusions, and standalone
verification commands without placing placeholders in this runnable source tree.

## Execution results and Artifact files

Detached commands do not write a Workbench `result.json`. They emit bounded JSON Lines to stdout:
progress messages followed by exactly one terminal result. With the template's Workbench-side
definition and default local Runtime Supports, the detached supervisor persists the latest accepted
message at:

```text
<rootDirectory>/<profileId>/executions/<executionId>/observation.json
```

Workbench stores the opaque execution receipt on the Run and uses it to observe that record after
the original caller disconnects. A successful terminal result contains each produced Artifact's
digest and opaque handoff receipt. The local backend publishes those Artifacts under the same
Profile-scoped root in `artifacts/`; other Runtime Supports may use different storage and receipt
formats.

The `output.json` inside an exported model Artifact is model metadata used by this Tiny Transformer.
It is not the detached execution result or a Workbench transport record. Human diagnostics go to
stderr; the default local supervisor retains only a bounded prefix in `stderr.log`.

## Runtime selection

The TypeScript binding defaults both execution and smoke tests to CPU with float32. A deployment can
select the runtime explicitly without changing any Workbench Contract:

```text
TA_AGENT_MODEL_BACKEND_DEVICE=cpu|cuda|mps
TA_AGENT_MODEL_BACKEND_DTYPE=float32|float16|bfloat16
```

Models, batches, and generated tensors use the same resolved device. Checkpoint tensors are
finalized on CPU and are loaded with `map_location="cpu"` before being moved to the selected runtime,
so an Artifact is not bound to the device that produced it. Unsupported device/dtype combinations
fail explicitly; the backend never silently discovers or changes hardware.

## Boundaries

- `infrastructure/` owns bounded JSON, protocol envelopes, cancellation, and Artifact publication.
- `model/` owns the Transformer, embedded demonstration text, training, and generation.
- `composition/` translates between Workbench requests, model calls, and Artifact files.

The embedded text is intentionally tiny and has no quality or benchmark meaning. Training produces
a new Base only. Modification inputs are rejected explicitly. The fixed demonstration tokenizer
maps characters outside its tiny vocabulary to an explicit replacement token, so every non-empty
Unicode prompt accepted by the TypeScript Contract remains callable without hidden normalization.

Human diagnostics are written to stderr. Model code must never write to protocol stdout. Published
checkpoints and Outputs contain JSON metadata plus a tensor-only PyTorch state dictionary; reads use
the restricted `weights_only` loading path.
