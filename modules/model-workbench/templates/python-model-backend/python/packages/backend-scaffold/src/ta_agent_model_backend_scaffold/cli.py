"""Thin command-line interface around the model-backend scaffold engine."""

from __future__ import annotations

import argparse
import shlex
import sys
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import TextIO, cast

from .contracts import TemplateIdentity
from .errors import ModelBackendScaffoldError, TemplateDescriptorError
from .materialize import scaffold_model_backend

_PROGRAM_NAME = "model-backend-scaffold"
_MAINTAINED_TEMPLATE_DIRECTORY_NAME = "model-backend"


def main(
    argv: Sequence[str] | None = None,
    *,
    template_root: Path | None = None,
    stdout: TextIO | None = None,
    stderr: TextIO | None = None,
) -> int:
    """Create one standalone backend and return a process exit code."""

    output = stdout if stdout is not None else sys.stdout
    error_output = stderr if stderr is not None else sys.stderr
    arguments = _parse_arguments(argv)
    try:
        identity = TemplateIdentity.from_project_name(
            arguments.project_name,
            arguments.package_name,
        )
        source = template_root or _maintained_template_root()
        result = scaffold_model_backend(source, arguments.target, identity)
    except ModelBackendScaffoldError as error:
        print(f"{_PROGRAM_NAME}: {error}", file=error_output)
        return 1

    print(f"Created Workbench model backend at {result.destination}", file=output)
    print(f"Python module: {result.identity.package_name}", file=output)
    print("Configure the Workbench-side definition with:", file=output)
    print(f"  backendModule: '{result.identity.package_name}'", file=output)
    print("Verify from the generated project:", file=output)
    print(f"  cd {shlex.quote(str(result.destination))}", file=output)
    for command in result.verification.fast:
        print(f"  {command}", file=output)
    print("Model verification:", file=output)
    for command in result.verification.model:
        print(f"  {command}", file=output)
    return 0


def _parse_arguments(argv: Sequence[str] | None) -> _CliArguments:
    parser = argparse.ArgumentParser(
        prog=_PROGRAM_NAME,
        description="Create a standalone Workbench-compatible Python model backend.",
    )
    parser.add_argument("--target", required=True, help="final project directory (must not exist)")
    parser.add_argument("--project-name", required=True, help="lowercase kebab-case project name")
    parser.add_argument(
        "--package-name",
        help="lowercase Python package name (defaults to project name with underscores)",
    )
    tokens = list(argv) if argv is not None else sys.argv[1:]
    if tokens[:1] == ["--"]:
        tokens = tokens[1:]
    namespace = parser.parse_args(tokens)
    return _CliArguments(
        target=Path(cast(str, namespace.target)),
        project_name=cast(str, namespace.project_name),
        package_name=cast(str | None, namespace.package_name),
    )


@dataclass(frozen=True, slots=True)
class _CliArguments:
    target: Path
    project_name: str
    package_name: str | None


def _maintained_template_root() -> Path:
    candidate = Path(__file__).resolve().parents[3] / _MAINTAINED_TEMPLATE_DIRECTORY_NAME
    if not candidate.is_dir():
        raise TemplateDescriptorError(
            f"maintained model backend template is unavailable: {candidate}"
        )
    return candidate
