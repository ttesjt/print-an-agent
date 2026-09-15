from __future__ import annotations

import json
from pathlib import Path

import pytest

from ta_agent_model_backend.composition.backend import create_backend_handlers
from ta_agent_model_backend.composition.constants import (
    CHECKPOINT_FORMAT,
    CHECKPOINT_METADATA_FILE_NAME,
    DEVICE_ENVIRONMENT_VARIABLE,
    DTYPE_ENVIRONMENT_VARIABLE,
    WEIGHTS_FILE_NAME,
)
from ta_agent_model_backend.infrastructure.constants import ARTIFACT_ROOT_ENVIRONMENT_VARIABLE
from ta_agent_model_backend.infrastructure.contracts import CancellationToken, OperationContext
from ta_agent_model_backend.infrastructure.json_values import JsonObject


def test_initialization_publishes_a_real_transformer_checkpoint(tmp_path: Path) -> None:
    handlers = create_backend_handlers(_environment(tmp_path))

    result = handlers.initialize(
        _initialization_request(),
        OperationContext(lambda _progress: None, CancellationToken()),
    )

    artifact = result["artifact"]
    assert isinstance(artifact, dict)
    receipt = artifact["receipt"]
    assert isinstance(receipt, dict)
    model_path = tmp_path / "profile" / "artifacts" / str(receipt["relativePath"])
    metadata = json.loads((model_path / CHECKPOINT_METADATA_FILE_NAME).read_text())
    assert metadata["format"] == CHECKPOINT_FORMAT
    assert metadata["configuration"]["embeddingDimension"] == 12
    assert (model_path / WEIGHTS_FILE_NAME).is_file()
    result_data = result["data"]
    assert isinstance(result_data, dict)
    assert result_data["device"] == "cpu"
    assert result_data["dtype"] == "float32"
    assert isinstance(result_data["parameterCount"], int)
    assert result_data["parameterCount"] > 0


def test_training_rejects_a_corrupted_source_artifact(tmp_path: Path) -> None:
    handlers = create_backend_handlers(_environment(tmp_path))
    initialized = handlers.initialize(
        _initialization_request(),
        OperationContext(lambda _progress: None, CancellationToken()),
    )
    artifact = initialized["artifact"]
    assert isinstance(artifact, dict)
    receipt = artifact["receipt"]
    assert isinstance(receipt, dict)
    checkpoint_directory = tmp_path / "profile" / "artifacts" / str(receipt["relativePath"])
    (checkpoint_directory / WEIGHTS_FILE_NAME).write_text("not a checkpoint", encoding="utf-8")

    with pytest.raises(ValueError, match="could not read model weights"):
        handlers.train(
            {
                "operation": "training",
                "profileId": "profile",
                "runId": "training-run",
                "source": {
                    "base": {
                        "artifact": {
                            "binding": {
                                "kind": "local-directory",
                                "access": "read-only",
                                "directory": str(checkpoint_directory),
                            }
                        }
                    },
                    "modifications": [],
                },
                "input": {"steps": 1, "batchSize": 1, "learningRate": 0.01, "seed": 11},
            },
            OperationContext(lambda _progress: None, CancellationToken()),
        )


def _environment(root_directory: Path) -> dict[str, str]:
    return {
        ARTIFACT_ROOT_ENVIRONMENT_VARIABLE: str(root_directory),
        DEVICE_ENVIRONMENT_VARIABLE: "cpu",
        DTYPE_ENVIRONMENT_VARIABLE: "float32",
    }


def _initialization_request() -> JsonObject:
    return {
        "operation": "initialization",
        "profileId": "profile",
        "runId": "run",
        "input": {
            "model": {
                "contextLength": 8,
                "embeddingDimension": 12,
                "attentionHeads": 3,
                "layers": 1,
                "feedForwardMultiplier": 2,
            },
            "seed": 7,
        },
    }
