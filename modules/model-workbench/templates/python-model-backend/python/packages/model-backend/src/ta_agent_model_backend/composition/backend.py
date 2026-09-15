from __future__ import annotations

import os
from collections.abc import Mapping
from pathlib import Path

from ..infrastructure.constants import ARTIFACT_ROOT_ENVIRONMENT_VARIABLE
from ..infrastructure.contracts import BackendHandlers
from ..model.constants import DEFAULT_DEVICE, DEFAULT_DTYPE
from ..model.runtime import resolve_torch_runtime
from ..model.service import TinyTransformerService
from .capabilities.export import create_export_handler
from .capabilities.initialization import create_initialization_handler
from .capabilities.invocation import create_invocation_handler
from .capabilities.training import create_training_handler
from .constants import DEVICE_ENVIRONMENT_VARIABLE, DTYPE_ENVIRONMENT_VARIABLE


def create_backend_handlers(
    environment: Mapping[str, str] | None = None,
) -> BackendHandlers:
    selected_environment = os.environ if environment is None else environment
    root_directory = _resolve_root_directory(selected_environment)
    runtime = resolve_torch_runtime(
        selected_environment.get(DEVICE_ENVIRONMENT_VARIABLE, DEFAULT_DEVICE),
        selected_environment.get(DTYPE_ENVIRONMENT_VARIABLE, DEFAULT_DTYPE),
    )
    model = TinyTransformerService()
    return BackendHandlers(
        initialize=create_initialization_handler(root_directory, model, runtime),
        train=create_training_handler(root_directory, model, runtime),
        export=create_export_handler(root_directory, model),
        invoke=create_invocation_handler(model, runtime),
    )


def _resolve_root_directory(environment: Mapping[str, str]) -> Path:
    value = environment.get(ARTIFACT_ROOT_ENVIRONMENT_VARIABLE)
    if value is None or not Path(value).is_absolute():
        raise ValueError(f"{ARTIFACT_ROOT_ENVIRONMENT_VARIABLE} must contain an absolute path")
    return Path(value)
