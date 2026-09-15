from __future__ import annotations

import json
from pathlib import Path

import pytest

from ta_agent_model_backend_scaffold import TemplateDescriptorError
from ta_agent_model_backend_scaffold.descriptor import (
    SUPPORTED_TEMPLATE_FORMAT_VERSION,
    SUPPORTED_TEMPLATE_KIND,
    read_template_descriptor,
)


def test_descriptor_parser_accepts_closed_supported_shape(tmp_path: Path) -> None:
    _write_descriptor(tmp_path)

    descriptor = read_template_descriptor(tmp_path)

    assert descriptor.kind == SUPPORTED_TEMPLATE_KIND
    assert descriptor.format_version == SUPPORTED_TEMPLATE_FORMAT_VERSION
    assert descriptor.identity.default.project_name == "source-project"
    assert descriptor.copy.include[0].as_posix() == "README.md"


def test_descriptor_parser_rejects_unknown_fields(tmp_path: Path) -> None:
    descriptor = _descriptor()
    descriptor["unknown"] = True
    _write_descriptor(tmp_path, descriptor)

    with pytest.raises(TemplateDescriptorError, match="invalid keys"):
        read_template_descriptor(tmp_path)


def test_descriptor_parser_rejects_escaping_copy_roots(tmp_path: Path) -> None:
    descriptor = _descriptor()
    descriptor["copy"] = {"include": ["../outside"], "exclude": ["dist/**"]}
    _write_descriptor(tmp_path, descriptor)

    with pytest.raises(TemplateDescriptorError, match="safe relative"):
        read_template_descriptor(tmp_path)


def _write_descriptor(root: Path, value: dict[str, object] | None = None) -> None:
    (root / "model-backend.template.json").write_text(
        json.dumps(value or _descriptor()),
        encoding="utf-8",
    )


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
        "copy": {"include": ["README.md"], "exclude": ["dist/**"]},
        "verification": {"fast": ["uv sync"], "model": ["uv sync --extra model"]},
    }
