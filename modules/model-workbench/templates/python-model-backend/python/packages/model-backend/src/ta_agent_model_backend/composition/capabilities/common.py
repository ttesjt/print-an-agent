from __future__ import annotations

import hashlib
from pathlib import Path

from ...infrastructure.artifacts import LocalArtifactPublisher
from ...infrastructure.constants import ARTIFACT_DIRECTORY_NAME
from ...infrastructure.json_values import (
    JsonObject,
    JsonValue,
    require_integer,
    require_object,
    require_string,
)
from ...model.constants import MAXIMUM_SEED, MINIMUM_SEED


def operation_identity_and_input(request: JsonObject) -> tuple[str, str, JsonObject]:
    profile_id = require_string(request.get("profileId"), "request.profileId")
    run_id = require_string(request.get("runId"), "request.runId")
    input_value = require_object(request.get("input"), "request.input")
    return profile_id, run_id, input_value


def parse_seed(value: JsonValue | None, path: str) -> int:
    return require_integer(value, path, minimum=MINIMUM_SEED, maximum=MAXIMUM_SEED)


def artifact_publisher(root_directory: Path, profile_id: str) -> LocalArtifactPublisher:
    return LocalArtifactPublisher(root_directory / profile_id / ARTIFACT_DIRECTORY_NAME)


def artifact_path(prefix: str, run_id: str) -> str:
    identity = hashlib.sha256(run_id.encode("utf-8")).hexdigest()
    return f"{prefix}/{identity}"
