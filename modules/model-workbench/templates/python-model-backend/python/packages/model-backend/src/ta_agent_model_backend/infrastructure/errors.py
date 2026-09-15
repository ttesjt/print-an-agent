from __future__ import annotations

from enum import StrEnum

from .constants import MAXIMUM_FAILURE_MESSAGE_CHARACTERS
from .json_values import JsonValue


class BackendErrorCode(StrEnum):
    INVALID_REQUEST = "BACKEND_INVALID_REQUEST"
    OPERATION_FAILED = "BACKEND_OPERATION_FAILED"
    CANCELLED = "BACKEND_CANCELLED"
    ARTIFACT_FAILURE = "BACKEND_ARTIFACT_FAILURE"


class BackendError(Exception):
    def __init__(
        self,
        code: BackendErrorCode,
        message: str,
        *,
        retryable: bool = False,
        diagnostics: JsonValue | None = None,
    ) -> None:
        bounded_message = message[:MAXIMUM_FAILURE_MESSAGE_CHARACTERS]
        super().__init__(bounded_message)
        self.code = code
        self.retryable = retryable
        self.diagnostics = diagnostics


class BackendCancelledError(BackendError):
    def __init__(self, reason: str = "Backend execution was cancelled.") -> None:
        super().__init__(BackendErrorCode.CANCELLED, reason)
