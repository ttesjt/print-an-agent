from __future__ import annotations

from pathlib import Path

from ....infrastructure.contracts import OperationContext, OperationHandler
from ....infrastructure.json_values import JsonObject
from ....model.contracts import TorchRuntime
from ....model.service import TinyTransformerService
from ...constants import INITIALIZATION_ARTIFACT_PREFIX
from ...model_io import write_checkpoint
from ..common import artifact_path, artifact_publisher, operation_identity_and_input
from .contracts import create_initialization_result_data, parse_initialization_input


def create_initialization_handler(
    root_directory: Path,
    model: TinyTransformerService,
    runtime: TorchRuntime,
) -> OperationHandler:
    def initialize(request: JsonObject, context: OperationContext) -> JsonObject:
        profile_id, run_id, input_value = operation_identity_and_input(request)
        parsed = parse_initialization_input(input_value)
        context.cancellation.raise_if_cancelled()
        checkpoint = model.initialize(parsed.model, runtime, seed=parsed.seed)
        artifact = artifact_publisher(root_directory, profile_id).publish(
            artifact_path(INITIALIZATION_ARTIFACT_PREFIX, run_id),
            lambda directory: write_checkpoint(directory, checkpoint),
        )
        return {
            "artifact": artifact.to_json(),
            "data": create_initialization_result_data(checkpoint, runtime),
        }

    return initialize
