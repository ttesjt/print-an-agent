# Backend qualification

The backend test tree separates cheap protocol confidence from framework-backed model confidence.
Keep this boundary when copying the backend into a new experiment repository.

## Suites

| Directory       | Responsibility                                           | PyTorch  |
| --------------- | -------------------------------------------------------- | -------- |
| `architecture/` | Dependency direction and test-layer invariants           | No       |
| `unit/`         | Isolated infrastructure and deterministic helpers        | No       |
| `protocol/`     | Black-box stdin/stdout execution contracts and failures  | No       |
| `model/`        | Tensors, optimization, checkpointing, export, generation | Required |
| `integration/`  | Real model behavior joined to backend composition        | Required |

`backend_testkit/` and `fixtures/` support the suites. The fake backend is a test process, not a
production CLI mode.

## Gates

From this Python project directory:

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

The first group is the fast, framework-free feedback loop. The second group is the required model
qualification gate. A missing model runtime is a failure in that gate. The standalone backend does
not contain its Workbench-side definition; the consuming repository owns the complete CPU Workbench
lifecycle smoke.

## Expectations for a copied model

Model experiments may replace architecture, training, tokenizer, checkpoint, export, and invocation
logic. They should retain tests proving:

- every detached operation emits valid progress and one terminal result;
- completed and streaming invocation obey their separate protocol;
- cancellation and failures retain stable system semantics;
- Artifact publication is deterministic and corrupted inputs fail explicitly;
- at least one tiny CPU lifecycle reaches the Workbench public API;
- Profile-scoped persistence and Artifact handoff do not cross Profile boundaries.

The CPU lifecycle proves integration, not model quality. Do not add downloads, large datasets,
accelerator requirements, convergence thresholds, or performance benchmarks to this gate.
