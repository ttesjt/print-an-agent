"""Strict parsing for the maintained backend-template descriptor."""

from __future__ import annotations

import json
from pathlib import Path, PurePosixPath
from typing import cast

from .contracts import (
    TemplateCopyDefinition,
    TemplateDescriptor,
    TemplateIdentity,
    TemplateIdentityDefinition,
    TemplateVerification,
)
from .errors import ScaffoldIdentityError, TemplateDescriptorError

TEMPLATE_DESCRIPTOR_FILE_NAME = "model-backend.template.json"
SUPPORTED_TEMPLATE_KIND = "ta-agent.python-model-backend-template"
SUPPORTED_TEMPLATE_FORMAT_VERSION = 1

_TOP_LEVEL_KEYS = frozenset({"kind", "formatVersion", "identity", "copy", "verification"})
_IDENTITY_KEYS = frozenset(
    {"defaultProjectName", "defaultPackageName", "projectNameToken", "packageNameToken"}
)
_COPY_KEYS = frozenset({"include", "exclude"})
_VERIFICATION_KEYS = frozenset({"fast", "model"})


def read_template_descriptor(template_root: Path) -> TemplateDescriptor:
    """Read and validate the closed descriptor at ``template_root``."""

    descriptor_path = template_root / TEMPLATE_DESCRIPTOR_FILE_NAME
    try:
        raw = cast(object, json.loads(descriptor_path.read_text(encoding="utf-8")))
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise TemplateDescriptorError(f"cannot read template descriptor: {error}") from error
    value = _require_object(raw, "descriptor")
    _require_exact_keys(value, _TOP_LEVEL_KEYS, "descriptor")
    kind = _require_string(value["kind"], "kind")
    if kind != SUPPORTED_TEMPLATE_KIND:
        raise TemplateDescriptorError(f"unsupported template kind: {kind}")
    format_version = value["formatVersion"]
    if type(format_version) is not int or format_version != SUPPORTED_TEMPLATE_FORMAT_VERSION:
        raise TemplateDescriptorError(f"unsupported template format version: {format_version!r}")

    identity = _parse_identity(value["identity"])
    copy = _parse_copy(value["copy"])
    verification = _parse_verification(value["verification"])
    return TemplateDescriptor(
        kind=kind,
        format_version=format_version,
        identity=identity,
        copy=copy,
        verification=verification,
    )


def _parse_identity(value: object) -> TemplateIdentityDefinition:
    raw = _require_object(value, "identity")
    _require_exact_keys(raw, _IDENTITY_KEYS, "identity")
    default_project_name = _require_string(raw["defaultProjectName"], "defaultProjectName")
    default_package_name = _require_string(raw["defaultPackageName"], "defaultPackageName")
    project_name_token = _require_string(raw["projectNameToken"], "projectNameToken")
    package_name_token = _require_string(raw["packageNameToken"], "packageNameToken")
    if project_name_token == package_name_token:
        raise TemplateDescriptorError("identity replacement tokens must be distinct")
    try:
        default = TemplateIdentity(default_project_name, default_package_name)
    except ScaffoldIdentityError as error:
        raise TemplateDescriptorError(f"template default identity is invalid: {error}") from error
    return TemplateIdentityDefinition(
        default=default,
        project_name_token=project_name_token,
        package_name_token=package_name_token,
    )


def _parse_copy(value: object) -> TemplateCopyDefinition:
    raw = _require_object(value, "copy")
    _require_exact_keys(raw, _COPY_KEYS, "copy")
    include = tuple(
        _require_relative_path(item, "copy.include")
        for item in _require_strings(raw["include"], "copy.include")
    )
    if len(frozenset(include)) != len(include):
        raise TemplateDescriptorError("copy.include must not contain duplicate paths")
    exclude = _require_strings(raw["exclude"], "copy.exclude")
    for pattern in exclude:
        _require_relative_pattern(pattern, "copy.exclude")
    return TemplateCopyDefinition(include=include, exclude=exclude)


def _parse_verification(value: object) -> TemplateVerification:
    raw = _require_object(value, "verification")
    _require_exact_keys(raw, _VERIFICATION_KEYS, "verification")
    return TemplateVerification(
        fast=_require_strings(raw["fast"], "verification.fast"),
        model=_require_strings(raw["model"], "verification.model"),
    )


def _require_object(value: object, path: str) -> dict[str, object]:
    if not isinstance(value, dict) or not all(isinstance(key, str) for key in value):
        raise TemplateDescriptorError(f"{path} must be an object")
    return cast(dict[str, object], value)


def _require_exact_keys(
    value: dict[str, object],
    expected: frozenset[str],
    path: str,
) -> None:
    actual = frozenset(value)
    if actual != expected:
        missing = sorted(expected - actual)
        unexpected = sorted(actual - expected)
        raise TemplateDescriptorError(
            f"{path} has invalid keys; missing={missing!r}, unexpected={unexpected!r}"
        )


def _require_strings(value: object, path: str) -> tuple[str, ...]:
    if (
        not isinstance(value, list)
        or not value
        or not all(isinstance(item, str) and item for item in value)
    ):
        raise TemplateDescriptorError(f"{path} must be a non-empty array of non-empty strings")
    return tuple(cast(list[str], value))


def _require_string(value: object, path: str) -> str:
    if not isinstance(value, str) or not value:
        raise TemplateDescriptorError(f"{path} must be a non-empty string")
    return value


def _require_relative_path(value: str, path: str) -> PurePosixPath:
    parsed = PurePosixPath(value)
    if parsed.is_absolute() or not parsed.parts or ".." in parsed.parts:
        raise TemplateDescriptorError(f"{path} must contain safe relative POSIX paths")
    return parsed


def _require_relative_pattern(value: str, path: str) -> None:
    parsed = PurePosixPath(value)
    if parsed.is_absolute() or not parsed.parts or ".." in parsed.parts:
        raise TemplateDescriptorError(f"{path} must contain safe relative POSIX patterns")
