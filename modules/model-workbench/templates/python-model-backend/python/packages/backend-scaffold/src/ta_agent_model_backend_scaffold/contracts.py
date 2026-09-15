"""Immutable contracts shared by descriptor parsing, materialization, and the CLI."""

from __future__ import annotations

import keyword
import re
from dataclasses import dataclass
from pathlib import Path, PurePosixPath

from .errors import ScaffoldIdentityError

_PROJECT_NAME_PATTERN = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
_PACKAGE_NAME_PATTERN = re.compile(r"^[a-z][a-z0-9_]*$")


@dataclass(frozen=True, slots=True)
class TemplateIdentity:
    """Requested distribution and import-package names for one generated backend."""

    project_name: str
    package_name: str

    def __post_init__(self) -> None:
        if _PROJECT_NAME_PATTERN.fullmatch(self.project_name) is None:
            raise ScaffoldIdentityError("project name must be lowercase kebab-case")
        if _PACKAGE_NAME_PATTERN.fullmatch(self.package_name) is None or keyword.iskeyword(
            self.package_name
        ):
            raise ScaffoldIdentityError("package name must be a non-keyword lowercase Python name")

    @classmethod
    def from_project_name(
        cls,
        project_name: str,
        package_name: str | None = None,
    ) -> TemplateIdentity:
        return cls(
            project_name=project_name,
            package_name=(
                package_name if package_name is not None else project_name.replace("-", "_")
            ),
        )


@dataclass(frozen=True, slots=True)
class TemplateIdentityDefinition:
    """Identity values and replacement tokens declared by the maintained template."""

    default: TemplateIdentity
    project_name_token: str
    package_name_token: str


@dataclass(frozen=True, slots=True)
class TemplateCopyDefinition:
    """Curated copy roots and exclusions declared by the maintained template."""

    include: tuple[PurePosixPath, ...]
    exclude: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class TemplateVerification:
    """Commands recommended after a project is generated."""

    fast: tuple[str, ...]
    model: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class TemplateDescriptor:
    """Closed, supported descriptor for one backend template format."""

    kind: str
    format_version: int
    identity: TemplateIdentityDefinition
    copy: TemplateCopyDefinition
    verification: TemplateVerification


@dataclass(frozen=True, slots=True)
class ScaffoldResult:
    """Result returned after a generated project is atomically published."""

    destination: Path
    identity: TemplateIdentity
    verification: TemplateVerification
