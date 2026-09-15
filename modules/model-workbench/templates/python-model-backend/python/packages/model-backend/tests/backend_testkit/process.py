from __future__ import annotations

import json
import os
import subprocess
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import cast

from ta_agent_model_backend.infrastructure.json_values import JsonObject, JsonValue

DEFAULT_BACKEND_TIMEOUT_SECONDS = 5.0


class BackendProtocolOutputError(ValueError):
    """Raised when a backend process emits output outside the JSON Lines protocol."""


@dataclass(frozen=True, slots=True)
class BackendProcessResult:
    return_code: int
    messages: tuple[JsonObject, ...]
    stderr: str


class BackendProcess:
    """Runs a backend command as an isolated stdin/stdout black box."""

    def __init__(
        self,
        executable: Sequence[str],
        *,
        environment: Mapping[str, str] | None = None,
        timeout_seconds: float = DEFAULT_BACKEND_TIMEOUT_SECONDS,
    ) -> None:
        if not executable:
            raise ValueError("executable must not be empty")
        if timeout_seconds <= 0:
            raise ValueError("timeout_seconds must be positive")
        self._executable = tuple(executable)
        self._environment = None if environment is None else dict(environment)
        self._timeout_seconds = timeout_seconds

    def run(self, command: str, request: JsonObject) -> BackendProcessResult:
        if not command:
            raise ValueError("command must not be empty")
        environment = os.environ.copy()
        if self._environment is not None:
            environment.update(self._environment)
        completed = subprocess.run(
            (*self._executable, command),
            input=_encode_request(request),
            capture_output=True,
            env=environment,
            check=False,
            timeout=self._timeout_seconds,
        )
        return BackendProcessResult(
            return_code=completed.returncode,
            messages=_parse_messages(completed.stdout),
            stderr=_decode_stderr(completed.stderr),
        )


def _encode_request(request: JsonObject) -> bytes:
    try:
        return json.dumps(
            request,
            ensure_ascii=False,
            allow_nan=False,
            separators=(",", ":"),
        ).encode("utf-8")
    except (TypeError, ValueError) as error:
        raise ValueError("request must be finite JSON") from error


def _parse_messages(payload: bytes) -> tuple[JsonObject, ...]:
    try:
        text = payload.decode("utf-8")
    except UnicodeDecodeError as error:
        raise BackendProtocolOutputError("backend stdout must be UTF-8") from error
    messages: list[JsonObject] = []
    for line_number, line in enumerate(text.splitlines(), start=1):
        try:
            value = cast(
                JsonValue,
                json.loads(line, parse_constant=_reject_json_constant),
            )
        except (json.JSONDecodeError, ValueError) as error:
            raise BackendProtocolOutputError(
                f"backend stdout line {line_number} must be finite JSON"
            ) from error
        if not isinstance(value, dict):
            raise BackendProtocolOutputError(
                f"backend stdout line {line_number} must contain a JSON object"
            )
        messages.append(value)
    return tuple(messages)


def _decode_stderr(payload: bytes) -> str:
    return payload.decode("utf-8", errors="replace")


def _reject_json_constant(value: str) -> None:
    raise ValueError(f"non-finite JSON number is not allowed: {value}")
