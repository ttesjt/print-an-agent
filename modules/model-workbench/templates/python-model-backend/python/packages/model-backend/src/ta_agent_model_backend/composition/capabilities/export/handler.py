from __future__ import annotations

from pathlib import Path

from ....infrastructure.contracts import OperationContext, OperationHandler
from ....infrastructure.json_values import JsonObject
from ....model.service import TinyTransformerService
from ...constants import EXPORT_ARTIFACT_PREFIX, OUTPUT_ARTIFACT_NAME
from ...model_io import read_source_checkpoint, write_export
from ..common import artifact_path, artifact_publisher, operation_identity_and_input
from .contracts import create_export_result_data, parse_export_input


def create_export_handler(
    root_directory: Path,
    model: TinyTransformerService,
) -> OperationHandler:
    def export(request: JsonObject, context: OperationContext) -> JsonObject:
        profile_id, run_id, input_value = operation_identity_and_input(request)
        parsed = parse_export_input(input_value)
        context.cancellation.raise_if_cancelled()
        exported = model.export(read_source_checkpoint(request))
        artifact = artifact_publisher(root_directory, profile_id).publish(
            artifact_path(EXPORT_ARTIFACT_PREFIX, run_id),
            lambda directory: write_export(directory, exported),
        )
        return {
            "artifacts": [{"name": OUTPUT_ARTIFACT_NAME, "artifact": artifact.to_json()}],
            "data": create_export_result_data(exported, parsed),
        }

    return export
