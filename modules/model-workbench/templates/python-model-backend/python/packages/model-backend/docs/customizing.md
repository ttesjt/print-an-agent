# Customizing the model backend

The canonical backend is intentionally a working model, not an abstract framework. Start by keeping
the complete CPU qualification green, then replace experiment-owned behavior in small slices.

## Change map

| Goal                                           | Primary source                                        |
| ---------------------------------------------- | ----------------------------------------------------- |
| Replace the architecture                       | `model/transformer.py`                                |
| Replace tokenization or vocabulary             | `model/text.py`, `model/constants.py`                 |
| Change model state and training results        | `model/contracts.py`                                  |
| Change initialization, training, or generation | `model/service.py`                                    |
| Change device or dtype support                 | `model/runtime.py`                                    |
| Change checkpoint or export files              | `composition/model_io.py`, `composition/constants.py` |
| Change one Capability value shape              | `composition/capabilities/<capability>/contracts.py`  |
| Change one Workbench operation mapping         | `composition/capabilities/<capability>/handler.py`    |
| Change environment-to-backend assembly         | `composition/backend.py`                              |
| Change the Workbench-side JSON Contract        | the template's Workbench definition                   |

`infrastructure/` is not a model customization surface. Change it only when the language-neutral
Workbench process protocol itself changes.

## Capability Contracts

The Workbench host validates model-specific input and output through JSON Schema before and after a
Capability call. The Python process still validates every consumed value because process input is an
untrusted boundary.

The Workbench host owns the matching Model Capability definition. Its schemas correspond to Python
code as follows:

| Capability     | TypeScript Contract                                           | Python boundary                                        |
| -------------- | ------------------------------------------------------------- | ------------------------------------------------------ |
| Initialization | `InitializationInputSchema`, `InitializationResultDataSchema` | `composition/capabilities/initialization/contracts.py` |
| Training       | `TrainingInputSchema`, `TrainingResultDataSchema`             | `composition/capabilities/training/contracts.py`       |
| Export         | `ExportInputSchema`, `ExportResultDataSchema`                 | `composition/capabilities/export/contracts.py`         |
| Invocation     | `InvocationInputSchema`, `InvocationOutputSchema`             | `composition/capabilities/invocation/contracts.py`     |

When a shape changes, update both sides in the same product change. Do not relax Python parsing on
the assumption that the TypeScript caller has already validated a value. Generated backend projects
remain ordinary Python projects; their Workbench host must provide or retain matching Model
Capability definitions. If the generated Python package is renamed, configure that definition to
launch the new dotted module name.

Keep model-specific field names and validation in the Capability's `contracts.py`. Its `handler.py`
should receive parsed values and place result data from the same Contract module inside the fixed
Workbench envelope. Do not move model-specific shapes into `infrastructure/`: transport owns the
stable Workbench envelope, not an experiment's value Contract.

## Model and data

The embedded character corpus exists only to keep the starter self-contained. A real experiment may
replace it with local data or with materialized input declared by its own Capability Contract. That
choice belongs to the model backend; the template does not download data or introduce Dataset
authority.

Training currently accepts a Base and deliberately rejects Modifications. Supporting additive
parameters requires coordinated changes to the model state, `read_source_checkpoint()`, the Trainer
result, and tests. Do not silently ignore a Modification stack.

Checkpoint tensors are finalized on CPU. Keep `map_location="cpu"` on reads, then move the model and
batches to the explicitly resolved runtime device. This preserves portable Artifacts while allowing
CPU, CUDA, or MPS deployment.

## Invocation

Completed and streaming invocation are two views of the same model behavior. A streaming backend
must emit `stream-start` before chunks and must terminate the process unsuccessfully if generation
fails after streaming begins. Cancellation remains cooperative: generation code must check the
provided cancellation function while producing tokens.

## Safe customization loop

1. Change one model or composition responsibility.
2. Update the Workbench-side JSON Schema if public values changed.
3. Add fast protocol coverage for envelope or failure semantics.
4. Add focused model coverage for framework behavior.
5. Run the framework-free and model verification commands documented in the project README.

Do not add model quality thresholds, large downloads, or accelerator requirements to the canonical
qualification gate. Those belong to experiment-specific evaluation outside the reusable template.
