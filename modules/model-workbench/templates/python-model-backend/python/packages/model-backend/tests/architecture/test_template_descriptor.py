from __future__ import annotations

import json
from pathlib import Path, PurePosixPath
from typing import cast

PACKAGE_ROOT = Path(__file__).parents[2]
DESCRIPTOR_PATH = PACKAGE_ROOT / "model-backend.template.json"
EXPECTED_TOP_LEVEL_KEYS = frozenset({"kind", "formatVersion", "identity", "copy", "verification"})
EXPECTED_IDENTITY_KEYS = frozenset(
    {"defaultProjectName", "defaultPackageName", "projectNameToken", "packageNameToken"}
)
EXPECTED_COPY_KEYS = frozenset({"include", "exclude"})
EXPECTED_VERIFICATION_KEYS = frozenset({"fast", "model"})


def test_template_descriptor_has_a_closed_supported_shape() -> None:
    descriptor = _read_object(DESCRIPTOR_PATH)

    assert frozenset(descriptor) == EXPECTED_TOP_LEVEL_KEYS
    assert descriptor["kind"] == "ta-agent.python-model-backend-template"
    assert descriptor["formatVersion"] == 1
    identity = _require_object(descriptor["identity"], "identity")
    copy = _require_object(descriptor["copy"], "copy")
    verification = _require_object(descriptor["verification"], "verification")
    assert frozenset(identity) == EXPECTED_IDENTITY_KEYS
    assert frozenset(copy) == EXPECTED_COPY_KEYS
    assert frozenset(verification) == EXPECTED_VERIFICATION_KEYS
    assert identity["defaultProjectName"] == identity["projectNameToken"]
    assert identity["defaultPackageName"] == identity["packageNameToken"]
    _require_strings(verification["fast"], "verification.fast")
    _require_strings(verification["model"], "verification.model")


def test_template_copy_roots_exist_and_remain_contained() -> None:
    descriptor = _read_object(DESCRIPTOR_PATH)
    copy = _require_object(descriptor["copy"], "copy")

    for relative_path in _require_strings(copy["include"], "copy.include"):
        parsed = PurePosixPath(relative_path)
        assert not parsed.is_absolute()
        assert ".." not in parsed.parts
        assert (PACKAGE_ROOT / parsed).exists()
    for pattern in _require_strings(copy["exclude"], "copy.exclude"):
        parsed = PurePosixPath(pattern)
        assert not parsed.is_absolute()
        assert ".." not in parsed.parts


def test_template_identity_tokens_are_present_in_copied_source() -> None:
    descriptor = _read_object(DESCRIPTOR_PATH)
    identity = _require_object(descriptor["identity"], "identity")
    copy = _require_object(descriptor["copy"], "copy")
    copied_text = "\n".join(
        _read_copy_text(relative_path)
        for relative_path in _require_strings(copy["include"], "copy.include")
    )

    for key in ("projectNameToken", "packageNameToken"):
        token = identity[key]
        assert isinstance(token, str)
        assert token in copied_text


def _read_object(path: Path) -> dict[str, object]:
    value = cast(object, json.loads(path.read_text(encoding="utf-8")))
    return _require_object(value, str(path))


def _require_object(value: object, path: str) -> dict[str, object]:
    if not isinstance(value, dict) or not all(isinstance(key, str) for key in value):
        raise TypeError(f"{path} must be an object")
    return cast(dict[str, object], value)


def _require_strings(value: object, path: str) -> tuple[str, ...]:
    if not isinstance(value, list) or not all(isinstance(item, str) and item for item in value):
        raise TypeError(f"{path} must be a non-empty array of non-empty strings")
    return tuple(cast(list[str], value))


def _read_copy_text(relative_path: str) -> str:
    path = PACKAGE_ROOT / PurePosixPath(relative_path)
    if path.is_file():
        return path.read_text(encoding="utf-8")
    return "\n".join(
        candidate.read_text(encoding="utf-8")
        for candidate in sorted(path.rglob("*"))
        if candidate.is_file() and candidate.suffix in {".md", ".py", ".toml"}
    )
