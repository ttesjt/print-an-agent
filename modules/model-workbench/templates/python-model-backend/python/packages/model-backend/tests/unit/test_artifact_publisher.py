from pathlib import Path

import pytest

from ta_agent_model_backend.infrastructure.artifacts import (
    LocalArtifactPublisher,
    derive_directory_digest,
)
from ta_agent_model_backend.infrastructure.errors import BackendError


def test_publisher_creates_deterministic_receipt_and_digest(tmp_path: Path) -> None:
    publisher = LocalArtifactPublisher(tmp_path)

    first = publisher.publish("training/run", _write_model)
    second = publisher.publish("training/run", _write_model)

    assert first == second
    assert first.receipt == {"kind": "local-directory", "relativePath": "training/run"}
    assert first.digest == derive_directory_digest(tmp_path / "training" / "run")


def test_publisher_rejects_conflicting_idempotent_output(tmp_path: Path) -> None:
    publisher = LocalArtifactPublisher(tmp_path)
    publisher.publish("training/run", _write_model)

    with pytest.raises(BackendError, match="different content"):
        publisher.publish("training/run", _write_conflicting_model)


def test_publisher_rejects_non_posix_relative_paths(tmp_path: Path) -> None:
    publisher = LocalArtifactPublisher(tmp_path)

    with pytest.raises(BackendError, match="POSIX separators"):
        publisher.publish("training\\run", _write_model)


def test_publisher_rejects_empty_artifacts_and_cleans_staging(tmp_path: Path) -> None:
    publisher = LocalArtifactPublisher(tmp_path)

    with pytest.raises(BackendError, match="empty"):
        publisher.publish("training/run", lambda _directory: None)

    assert list((tmp_path / ".staging").iterdir()) == []


def _write_model(directory: Path) -> None:
    (directory / "model").write_text("a", encoding="utf-8")


def _write_conflicting_model(directory: Path) -> None:
    (directory / "model").write_text("b", encoding="utf-8")
