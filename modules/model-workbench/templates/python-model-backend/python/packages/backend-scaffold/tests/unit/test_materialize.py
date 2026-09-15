from __future__ import annotations

import json
from pathlib import Path

import pytest

from ta_agent_model_backend_scaffold import (
    ScaffoldDestinationError,
    TemplateIdentity,
    TemplateMaterializationError,
    scaffold_model_backend,
)
from ta_agent_model_backend_scaffold.descriptor import (
    SUPPORTED_TEMPLATE_FORMAT_VERSION,
    SUPPORTED_TEMPLATE_KIND,
)


def test_scaffold_refuses_an_existing_destination_without_modifying_it(tmp_path: Path) -> None:
    source = _minimal_template(tmp_path / "source")
    destination = tmp_path / "existing"
    destination.mkdir()
    marker = destination / "owned.txt"
    marker.write_text("keep", encoding="utf-8")

    with pytest.raises(ScaffoldDestinationError, match="already exists"):
        scaffold_model_backend(source, destination, TemplateIdentity("new-project", "new_project"))

    assert marker.read_text(encoding="utf-8") == "keep"


def test_scaffold_refuses_a_destination_inside_the_template(tmp_path: Path) -> None:
    source = _minimal_template(tmp_path / "source")

    with pytest.raises(ScaffoldDestinationError, match="must not be inside"):
        scaffold_model_backend(
            source,
            source / "generated",
            TemplateIdentity("new-project", "new_project"),
        )


def test_scaffold_rejects_symlinks_and_removes_staging_output(tmp_path: Path) -> None:
    source = _minimal_template(tmp_path / "source")
    external = tmp_path / "external.txt"
    external.write_text("external", encoding="utf-8")
    linked = source / "linked.txt"
    linked.symlink_to(external)
    descriptor = _descriptor()
    descriptor["copy"] = {"include": ["linked.txt"], "exclude": ["dist/**"]}
    _write_descriptor(source, descriptor)
    destination = tmp_path / "generated"

    with pytest.raises(TemplateMaterializationError, match="must not contain symlinks"):
        scaffold_model_backend(
            source,
            destination,
            TemplateIdentity("new-project", "new_project"),
        )

    assert not destination.exists()
    assert not tuple(tmp_path.glob(".generated.scaffold-*"))


def test_scaffold_rejects_an_intermediate_symlink_that_escapes_the_template(
    tmp_path: Path,
) -> None:
    source = _minimal_template(tmp_path / "source")
    external = tmp_path / "external"
    external.mkdir()
    (external / "secret.txt").write_text("secret", encoding="utf-8")
    (source / "bridge").symlink_to(external, target_is_directory=True)
    descriptor = _descriptor()
    copy = descriptor["copy"]
    assert isinstance(copy, dict)
    copy["include"] = [*copy["include"], "bridge/secret.txt"]
    _write_descriptor(source, descriptor)
    destination = tmp_path / "generated"

    with pytest.raises(TemplateMaterializationError, match="must not contain symlinks"):
        scaffold_model_backend(
            source,
            destination,
            TemplateIdentity("new-project", "new_project"),
        )

    assert not destination.exists()
    assert not tuple(tmp_path.glob(".generated.scaffold-*"))


def test_scaffold_rejects_a_dangling_destination_symlink(tmp_path: Path) -> None:
    source = _minimal_template(tmp_path / "source")
    destination = tmp_path / "generated"
    linked_target = tmp_path / "unexpected-location"
    destination.symlink_to(linked_target, target_is_directory=True)

    with pytest.raises(ScaffoldDestinationError, match="already exists"):
        scaffold_model_backend(
            source,
            destination,
            TemplateIdentity("new-project", "new_project"),
        )

    assert destination.is_symlink()
    assert not linked_target.exists()


def _minimal_template(root: Path) -> Path:
    package = root / "src" / "source_project"
    package.mkdir(parents=True)
    (package / "__init__.py").write_text("", encoding="utf-8")
    (package / "cli.py").write_text("def main() -> int:\n    return 0\n", encoding="utf-8")
    (root / "README.md").write_text("# source-project\n", encoding="utf-8")
    (root / "pyproject.toml").write_text(
        """[project]
name = "source-project"
version = "0.1.0"

[project.scripts]
source-project = "source_project.cli:main"
""",
        encoding="utf-8",
    )
    _write_descriptor(root, _descriptor())
    return root


def _write_descriptor(root: Path, value: dict[str, object]) -> None:
    (root / "model-backend.template.json").write_text(json.dumps(value), encoding="utf-8")


def _descriptor() -> dict[str, object]:
    return {
        "kind": SUPPORTED_TEMPLATE_KIND,
        "formatVersion": SUPPORTED_TEMPLATE_FORMAT_VERSION,
        "identity": {
            "defaultProjectName": "source-project",
            "defaultPackageName": "source_project",
            "projectNameToken": "source-project",
            "packageNameToken": "source_project",
        },
        "copy": {
            "include": ["README.md", "model-backend.template.json", "pyproject.toml", "src"],
            "exclude": ["dist/**"],
        },
        "verification": {"fast": ["uv sync"], "model": ["uv sync --extra model"]},
    }
