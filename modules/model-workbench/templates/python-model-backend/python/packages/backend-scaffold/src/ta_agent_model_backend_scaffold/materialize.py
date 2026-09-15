"""Safe, deterministic materialization of one backend template."""

from __future__ import annotations

import fnmatch
import os
import shutil
import tempfile
import tomllib
from pathlib import Path, PurePosixPath
from typing import cast

from .contracts import ScaffoldResult, TemplateDescriptor, TemplateIdentity
from .descriptor import read_template_descriptor
from .errors import (
    ModelBackendScaffoldError,
    ScaffoldDestinationError,
    TemplateDescriptorError,
    TemplateMaterializationError,
)

_TEXT_FILE_SUFFIXES = frozenset({".json", ".md", ".py", ".toml", ".txt", ".yaml", ".yml"})
_SOURCE_DIRECTORY_NAME = "src"
_PYPROJECT_FILE_NAME = "pyproject.toml"


def scaffold_model_backend(
    template_root: Path,
    destination: Path,
    identity: TemplateIdentity,
) -> ScaffoldResult:
    """Materialize and atomically publish a standalone backend project."""

    source = _resolve_template_root(template_root)
    descriptor = read_template_descriptor(source)
    requested_target, target = _resolve_destination(destination)
    _validate_destination(source, requested_target, target)
    try:
        target.parent.mkdir(parents=True, exist_ok=True)
        staging = Path(
            tempfile.mkdtemp(prefix=f".{target.name}.scaffold-", dir=target.parent)
        ).resolve(strict=True)
    except OSError as error:
        raise ScaffoldDestinationError(f"cannot prepare destination parent: {error}") from error

    published = False
    try:
        _copy_template(source, staging, descriptor)
        _rewrite_identity(staging, descriptor, identity)
        _validate_materialized_project(staging, identity)
        if _path_exists(requested_target) or _path_exists(target):
            raise ScaffoldDestinationError(f"destination already exists: {requested_target}")
        staging.rename(target)
        published = True
    except ModelBackendScaffoldError:
        raise
    except (OSError, UnicodeError) as error:
        raise TemplateMaterializationError(
            f"cannot materialize backend template: {error}"
        ) from error
    finally:
        if not published:
            shutil.rmtree(staging, ignore_errors=True)

    return ScaffoldResult(
        destination=target,
        identity=identity,
        verification=descriptor.verification,
    )


def _resolve_template_root(template_root: Path) -> Path:
    try:
        source = template_root.expanduser().resolve(strict=True)
    except OSError as error:
        raise TemplateDescriptorError(f"template root does not exist: {template_root}") from error
    if not source.is_dir():
        raise TemplateDescriptorError(f"template root must be a directory: {source}")
    return source


def _resolve_destination(destination: Path) -> tuple[Path, Path]:
    requested = Path(os.path.abspath(destination.expanduser()))
    if _path_exists(requested):
        raise ScaffoldDestinationError(f"destination already exists: {requested}")
    return requested, requested.resolve(strict=False)


def _validate_destination(source: Path, requested: Path, target: Path) -> None:
    if _path_exists(requested) or _path_exists(target):
        raise ScaffoldDestinationError(f"destination already exists: {requested}")
    if target == source or source in target.parents:
        raise ScaffoldDestinationError("destination must not be inside the maintained template")


def _copy_template(source: Path, destination: Path, descriptor: TemplateDescriptor) -> None:
    for relative_path in descriptor.copy.include:
        _copy_entry(source, destination, relative_path, descriptor.copy.exclude)


def _copy_entry(
    source_root: Path,
    destination_root: Path,
    relative_path: PurePosixPath,
    exclusions: tuple[str, ...],
) -> None:
    if _is_excluded(relative_path, exclusions):
        return
    source = _resolve_source_entry(source_root, relative_path)
    destination = destination_root.joinpath(*relative_path.parts)
    if source.is_dir():
        destination.mkdir(parents=True, exist_ok=True)
        children = sorted(source.iterdir(), key=lambda path: path.name.encode("utf-8"))
        for child in children:
            _copy_entry(source_root, destination_root, relative_path / child.name, exclusions)
        return
    if not source.is_file():
        raise TemplateMaterializationError(
            f"template copy root must be a regular file or directory: {relative_path}"
        )
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, destination, follow_symlinks=False)


def _resolve_source_entry(source_root: Path, relative_path: PurePosixPath) -> Path:
    source = source_root
    for part in relative_path.parts:
        source /= part
        if source.is_symlink():
            raise TemplateMaterializationError(
                f"template must not contain symlinks: {relative_path}"
            )
    try:
        resolved = source.resolve(strict=True)
    except OSError as error:
        raise TemplateMaterializationError(
            f"template copy root does not exist: {relative_path}"
        ) from error
    if resolved != source_root and source_root not in resolved.parents:
        raise TemplateMaterializationError(
            f"template copy root escapes the template: {relative_path}"
        )
    return resolved


def _is_excluded(relative_path: PurePosixPath, exclusions: tuple[str, ...]) -> bool:
    value = relative_path.as_posix()
    return any(
        fnmatch.fnmatchcase(value, pattern) or fnmatch.fnmatchcase(f"{value}/", pattern)
        for pattern in exclusions
    )


def _rewrite_identity(
    destination: Path,
    descriptor: TemplateDescriptor,
    identity: TemplateIdentity,
) -> None:
    replacements = (
        (descriptor.identity.project_name_token, identity.project_name),
        (descriptor.identity.package_name_token, identity.package_name),
    )
    _rewrite_text(destination, replacements)
    _rewrite_paths(destination, replacements)


def _rewrite_text(root: Path, replacements: tuple[tuple[str, str], ...]) -> None:
    for path in _sorted_tree(root):
        if not path.is_file() or path.suffix not in _TEXT_FILE_SUFFIXES:
            continue
        original = path.read_text(encoding="utf-8")
        rewritten = original
        for source, destination in replacements:
            rewritten = rewritten.replace(source, destination)
        if rewritten != original:
            path.write_text(rewritten, encoding="utf-8")


def _rewrite_paths(root: Path, replacements: tuple[tuple[str, str], ...]) -> None:
    paths = sorted(
        root.rglob("*"),
        key=lambda path: (-len(path.parts), path.as_posix().encode("utf-8")),
    )
    for path in paths:
        rewritten_name = path.name
        for source, destination in replacements:
            rewritten_name = rewritten_name.replace(source, destination)
        if rewritten_name == path.name:
            continue
        rewritten_path = path.with_name(rewritten_name)
        if _path_exists(rewritten_path):
            raise TemplateMaterializationError(
                f"identity rewrite target already exists: {rewritten_path.relative_to(root)}"
            )
        path.rename(rewritten_path)


def _validate_materialized_project(root: Path, identity: TemplateIdentity) -> None:
    for path in _sorted_tree(root):
        if path.is_symlink():
            raise TemplateMaterializationError(
                f"generated project must not contain symlinks: {path.relative_to(root)}"
            )
    generated_descriptor = read_template_descriptor(root)
    if generated_descriptor.identity.default != identity:
        raise TemplateMaterializationError(
            "generated descriptor identity does not match the request"
        )
    package_root = root / _SOURCE_DIRECTORY_NAME / identity.package_name
    if not package_root.is_dir() or not (package_root / "__init__.py").is_file():
        raise TemplateMaterializationError("generated Python import package is missing")
    pyproject = _read_pyproject(root / _PYPROJECT_FILE_NAME)
    project = _require_toml_table(pyproject.get("project"), "project")
    if project.get("name") != identity.project_name:
        raise TemplateMaterializationError("generated distribution name does not match the request")
    scripts = _require_toml_table(project.get("scripts"), "project.scripts")
    expected_entry_point = f"{identity.package_name}.cli:main"
    if scripts.get(identity.project_name) != expected_entry_point:
        raise TemplateMaterializationError(
            "generated command entry point does not match the request"
        )


def _read_pyproject(path: Path) -> dict[str, object]:
    try:
        with path.open("rb") as handle:
            value = cast(object, tomllib.load(handle))
    except (OSError, tomllib.TOMLDecodeError) as error:
        raise TemplateMaterializationError(f"generated pyproject is invalid: {error}") from error
    if not isinstance(value, dict) or not all(isinstance(key, str) for key in value):
        raise TemplateMaterializationError("generated pyproject must contain a TOML table")
    return cast(dict[str, object], value)


def _require_toml_table(value: object, path: str) -> dict[str, object]:
    if not isinstance(value, dict) or not all(isinstance(key, str) for key in value):
        raise TemplateMaterializationError(f"generated {path} must be a TOML table")
    return cast(dict[str, object], value)


def _sorted_tree(root: Path) -> list[Path]:
    return sorted(root.rglob("*"), key=lambda path: path.as_posix().encode("utf-8"))


def _path_exists(path: Path) -> bool:
    return os.path.lexists(path)
