from __future__ import annotations

from io import StringIO
from pathlib import Path

from ta_agent_model_backend_scaffold.cli import main

MODEL_BACKEND_TEMPLATE_ROOT = Path(__file__).parents[3] / "model-backend"


def test_cli_creates_a_renamed_standalone_backend(tmp_path: Path) -> None:
    destination = tmp_path / "sample-backend"
    stdout = StringIO()
    stderr = StringIO()

    exit_code = main(
        [
            "--",
            "--target",
            str(destination),
            "--project-name",
            "sample-backend",
        ],
        template_root=MODEL_BACKEND_TEMPLATE_ROOT,
        stdout=stdout,
        stderr=stderr,
    )

    assert exit_code == 0
    assert stderr.getvalue() == ""
    assert (destination / "src" / "sample_backend" / "__init__.py").is_file()
    assert "Python module: sample_backend" in stdout.getvalue()
    assert "backendModule: 'sample_backend'" in stdout.getvalue()
    assert f"cd {destination}" in stdout.getvalue()


def test_cli_reports_an_existing_destination_without_modifying_it(tmp_path: Path) -> None:
    destination = tmp_path / "existing"
    destination.mkdir()
    marker = destination / "owned.txt"
    marker.write_text("keep", encoding="utf-8")
    stderr = StringIO()

    exit_code = main(
        [
            "--target",
            str(destination),
            "--project-name",
            "sample-backend",
        ],
        template_root=MODEL_BACKEND_TEMPLATE_ROOT,
        stdout=StringIO(),
        stderr=stderr,
    )

    assert exit_code == 1
    assert "destination already exists" in stderr.getvalue()
    assert marker.read_text(encoding="utf-8") == "keep"


def test_cli_rejects_invalid_identity_without_creating_target(tmp_path: Path) -> None:
    destination = tmp_path / "generated"
    stderr = StringIO()

    exit_code = main(
        [
            "--target",
            str(destination),
            "--project-name",
            "Invalid Name",
        ],
        template_root=MODEL_BACKEND_TEMPLATE_ROOT,
        stdout=StringIO(),
        stderr=stderr,
    )

    assert exit_code == 1
    assert "lowercase kebab-case" in stderr.getvalue()
    assert not destination.exists()
