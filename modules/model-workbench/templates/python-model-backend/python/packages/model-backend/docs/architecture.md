# Backend ownership boundaries

This backend is both a runnable Tiny Transformer and the canonical source used to scaffold generated
model projects. Its source tree is divided by responsibility, not by implementation technology.

## Dependency direction

```text
              composition
              /         \
    infrastructure     model
```

`composition` is the only source area allowed to know both sides. `infrastructure` and `model` are
siblings and must remain independent.

### `infrastructure/`

Template-owned Workbench transport mechanics:

- bounded JSON request parsing and JSON Lines output;
- operation, progress, terminal, completed, and streaming envelopes;
- cancellation and CLI dispatch;
- deterministic local Artifact publication;
- backend-level error normalization.

This area must not import `model` or `composition`. An experiment normally preserves it unchanged.
It is intentionally local source in this template; it is not a separately versioned backend-kit.

### `model/`

Experiment-owned model behavior:

- architecture and tokenizer;
- device and dtype resolution;
- initialization and training;
- checkpoint state;
- export and generation.

This area must not import `infrastructure` or `composition`. It should be usable and testable without
knowing that Workbench exists.

### `composition/`

The explicit integration seam:

- parses operation-specific values from Workbench requests;
- loads materialized model inputs and writes model-specific Artifacts;
- calls model behavior;
- returns the result shapes declared by the Workbench-side Contracts;
- assembles the handlers used by the CLI entry point.

This code is expected to change when an experiment changes its model Contract or Artifact format.
Generic process and protocol behavior does not belong here.

Each Model Capability has the same local structure under `composition/capabilities/`:

```text
<capability>/
  contracts.py  # parse model-specific values and construct model-specific result data
  handler.py    # orchestrate model calls, progress, and Artifact publication
```

`contracts.py` is the Python executable boundary paired with the Capability's JSON Schema in the
Workbench-side definition. It owns only model-specific values. `handler.py` must use that boundary
instead of interpreting those values inline, while retaining the fixed Workbench result envelope
around them. The shared Workbench request identity and local Artifact path helpers remain in
`capabilities/common.py`; they are not model-specific value Contracts.

## Root entry point

`ta_agent_model_backend.cli` keeps protocol-only package imports free of PyTorch. It imports the real
composition only when the executable starts and reports a focused diagnostic if optional model
dependencies are absent.

These boundaries are enforced by architecture tests. They are directory-level ownership rules for
the template, not package-version authority and not a promise that generated projects can be
automatically upgraded.
