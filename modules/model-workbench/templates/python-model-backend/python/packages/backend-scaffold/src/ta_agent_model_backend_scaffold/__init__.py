"""Create standalone Workbench-compatible Python model backends."""

from .contracts import ScaffoldResult, TemplateDescriptor, TemplateIdentity
from .errors import (
    ModelBackendScaffoldError,
    ScaffoldDestinationError,
    ScaffoldIdentityError,
    TemplateDescriptorError,
    TemplateMaterializationError,
)
from .materialize import scaffold_model_backend

__all__ = [
    "ModelBackendScaffoldError",
    "ScaffoldDestinationError",
    "ScaffoldIdentityError",
    "ScaffoldResult",
    "TemplateDescriptor",
    "TemplateDescriptorError",
    "TemplateIdentity",
    "TemplateMaterializationError",
    "scaffold_model_backend",
]
