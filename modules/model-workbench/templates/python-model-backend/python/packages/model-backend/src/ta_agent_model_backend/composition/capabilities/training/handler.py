from __future__ import annotations

from pathlib import Path

from ....infrastructure.contracts import OperationContext, OperationHandler
from ....infrastructure.json_values import JsonObject
from ....model.contracts import TorchRuntime, TrainingProgress
from ....model.service import TinyTransformerService
from ...constants import TRAINING_ARTIFACT_PREFIX
from ...model_io import read_source_checkpoint, write_checkpoint
from ..common import artifact_path, artifact_publisher, operation_identity_and_input
from .contracts import create_training_progress, create_training_result_data, parse_training_input


def create_training_handler(
    root_directory: Path,
    model: TinyTransformerService,
    runtime: TorchRuntime,
) -> OperationHandler:
    def train(request: JsonObject, context: OperationContext) -> JsonObject:
        profile_id, run_id, input_value = operation_identity_and_input(request)
        source = read_source_checkpoint(request)
        parsed = parse_training_input(input_value)

        def report(progress: TrainingProgress) -> None:
            context.report_progress(create_training_progress(progress))

        trained = model.train(
            source,
            runtime,
            steps=parsed.steps,
            batch_size=parsed.batch_size,
            learning_rate=parsed.learning_rate,
            seed=parsed.seed,
            report_progress=report,
            check_cancellation=context.cancellation.raise_if_cancelled,
        )
        artifact = artifact_publisher(root_directory, profile_id).publish(
            artifact_path(TRAINING_ARTIFACT_PREFIX, run_id),
            lambda directory: write_checkpoint(directory, trained.checkpoint),
        )
        return {
            "assetKind": "base",
            "artifact": artifact.to_json(),
            "data": create_training_result_data(trained),
        }

    return train
