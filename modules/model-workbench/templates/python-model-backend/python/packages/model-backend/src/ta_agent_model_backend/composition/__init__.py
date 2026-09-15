"""Maps Workbench protocol requests to the selected model implementation."""

from .backend import create_backend_handlers

__all__ = ["create_backend_handlers"]
