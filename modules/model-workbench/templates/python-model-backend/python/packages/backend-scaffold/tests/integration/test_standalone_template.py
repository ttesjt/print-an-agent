from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

from ta_agent_model_backend_scaffold import TemplateIdentity, scaffold_model_backend

MODEL_BACKEND_TEMPLATE_ROOT = Path(__file__).parents[3] / "model-backend"
PROJECT_NAME = "qualified-model-backend"
PACKAGE_NAME = "qualified_model_backend"
COMMAND_TIMEOUT_SECONDS = 30.0
FORBIDDEN_STANDALONE_DOCUMENTATION_FRAGMENTS = (
    "modules/model-workbench/",
    "pnpm ",
)


def test_scaffolded_template_imports_tests_and_builds_independently(tmp_path: Path) -> None:
    destination = tmp_path / PROJECT_NAME
    scaffold_model_backend(
        MODEL_BACKEND_TEMPLATE_ROOT,
        destination,
        TemplateIdentity(project_name=PROJECT_NAME, package_name=PACKAGE_NAME),
    )

    assert not list(destination.rglob("__pycache__"))
    pyproject = (destination / "pyproject.toml").read_text(encoding="utf-8")
    assert f'name = "{PROJECT_NAME}"' in pyproject
    assert f'{PROJECT_NAME} = "{PACKAGE_NAME}.cli:main"' in pyproject
    assert (destination / "src" / PACKAGE_NAME / "__init__.py").is_file()
    _assert_standalone_documentation(destination)

    environment = os.environ.copy()
    environment["PYTHONPATH"] = os.pathsep.join(
        (str(destination / "src"), str(destination / "tests"))
    )
    _run(
        (sys.executable, "-c", f"import {PACKAGE_NAME}"),
        working_directory=destination,
        environment=environment,
    )
    _run(
        (
            sys.executable,
            "-m",
            "pytest",
            "tests/architecture",
            "tests/unit",
            "tests/protocol",
        ),
        working_directory=destination,
        environment=environment,
    )
    distribution_directory = tmp_path / "dist"
    _run(
        (
            "uv",
            "build",
            "--offline",
            "--no-build-isolation",
            "--out-dir",
            str(distribution_directory),
            str(destination),
        ),
        working_directory=destination,
        environment=environment,
    )
    distributions = tuple(path.name for path in distribution_directory.iterdir())
    assert any(name.endswith(".whl") for name in distributions)
    assert any(name.endswith(".tar.gz") for name in distributions)


def _assert_standalone_documentation(destination: Path) -> None:
    documentation = (
        destination / "README.md",
        destination / "tests" / "README.md",
        *(destination / "docs").glob("**/*.md"),
    )
    for path in documentation:
        content = path.read_text(encoding="utf-8")
        for fragment in FORBIDDEN_STANDALONE_DOCUMENTATION_FRAGMENTS:
            assert fragment not in content, f"{path.relative_to(destination)} contains {fragment!r}"


def _run(
    command: tuple[str, ...],
    *,
    working_directory: Path,
    environment: dict[str, str],
) -> None:
    result = subprocess.run(
        command,
        cwd=working_directory,
        env=environment,
        capture_output=True,
        text=True,
        check=False,
        timeout=COMMAND_TIMEOUT_SECONDS,
    )
    assert result.returncode == 0, (
        f"command failed: {' '.join(command)}\nstdout:\n{result.stdout}\nstderr:\n{result.stderr}"
    )
