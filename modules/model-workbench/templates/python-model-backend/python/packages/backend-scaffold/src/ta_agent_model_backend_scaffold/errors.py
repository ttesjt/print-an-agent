"""Typed failures raised by the model-backend scaffold boundary."""


class ModelBackendScaffoldError(Exception):
    """Base class for expected scaffold failures."""


class ScaffoldIdentityError(ModelBackendScaffoldError):
    """The requested project or Python package identity is invalid."""


class ScaffoldDestinationError(ModelBackendScaffoldError):
    """The requested destination cannot be safely created."""


class TemplateDescriptorError(ModelBackendScaffoldError):
    """The maintained template descriptor is malformed or unsupported."""


class TemplateMaterializationError(ModelBackendScaffoldError):
    """The maintained template could not be safely materialized."""
