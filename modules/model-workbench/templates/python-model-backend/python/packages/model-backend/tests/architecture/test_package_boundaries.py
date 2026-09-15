from __future__ import annotations

import ast
from pathlib import Path

PACKAGE_ROOT = Path(__file__).parents[2] / "src" / "ta_agent_model_backend"
TEST_ROOT = Path(__file__).parents[1]
CAPABILITY_NAMES = ("export", "initialization", "invocation", "training")
CAPABILITY_MODULE_NAMES = frozenset({"__init__.py", "contracts.py", "handler.py"})
FORBIDDEN_DEPENDENCIES = {
    "infrastructure": frozenset({"composition", "model"}),
    "model": frozenset({"composition", "infrastructure"}),
}
FAST_TEST_DIRECTORIES = ("backend_testkit", "fixtures", "protocol", "unit")
FAST_TEST_FORBIDDEN_IMPORTS = (
    "torch",
    "ta_agent_model_backend.composition",
    "ta_agent_model_backend.model",
)


def test_model_and_infrastructure_remain_independent() -> None:
    violations: list[str] = []
    for owner, forbidden in FORBIDDEN_DEPENDENCIES.items():
        for source_path in sorted((PACKAGE_ROOT / owner).rglob("*.py")):
            for dependency in _imported_backend_areas(source_path):
                if dependency in forbidden:
                    violations.append(
                        f"{source_path.relative_to(PACKAGE_ROOT)} imports {dependency}"
                    )

    assert violations == []


def test_fast_test_layers_do_not_import_the_optional_model_stack() -> None:
    violations: list[str] = []
    for directory_name in FAST_TEST_DIRECTORIES:
        for source_path in sorted((TEST_ROOT / directory_name).rglob("*.py")):
            for module in _imported_modules(source_path):
                if any(
                    module == forbidden or module.startswith(f"{forbidden}.")
                    for forbidden in FAST_TEST_FORBIDDEN_IMPORTS
                ):
                    violations.append(f"{source_path.relative_to(TEST_ROOT)} imports {module}")

    assert violations == []


def test_capabilities_share_the_contract_and_handler_layout() -> None:
    capabilities_root = PACKAGE_ROOT / "composition" / "capabilities"
    actual_capabilities = tuple(
        path.name
        for path in sorted(capabilities_root.iterdir())
        if path.is_dir() and not path.name.startswith("__")
    )
    assert actual_capabilities == CAPABILITY_NAMES

    for capability_name in CAPABILITY_NAMES:
        capability_root = capabilities_root / capability_name
        module_names = {path.name for path in capability_root.iterdir() if path.suffix == ".py"}
        assert module_names == CAPABILITY_MODULE_NAMES


def _imported_backend_areas(source_path: Path) -> set[str]:
    dependencies: set[str] = set()
    for module in _imported_modules(source_path):
        dependencies.update(_backend_area(module))
    return dependencies


def _imported_modules(source_path: Path) -> set[str]:
    tree = ast.parse(source_path.read_text(encoding="utf-8"), filename=str(source_path))
    modules: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            modules.update(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module is not None:
            modules.add(node.module)
    return modules


def _backend_area(module: str) -> set[str]:
    parts = module.split(".")
    if parts[0] == "ta_agent_model_backend" and len(parts) > 1:
        return {parts[1]}
    if parts[0] in {"composition", "infrastructure", "model"}:
        return {parts[0]}
    return set()
