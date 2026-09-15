from __future__ import annotations

import json
from typing import BinaryIO, TextIO, cast

from .constants import (
    MAXIMUM_PROTOCOL_MESSAGE_BYTES,
    MAXIMUM_REQUEST_BYTES,
    ExecutionStatus,
    InvocationMessageKind,
    OperationMessageKind,
)
from .errors import BackendError
from .json_values import JsonObject, JsonValue, require_object


def read_request(stream: BinaryIO, maximum_bytes: int = MAXIMUM_REQUEST_BYTES) -> JsonObject:
    payload = stream.read(maximum_bytes + 1)
    if len(payload) > maximum_bytes:
        raise ValueError(f"request exceeds {maximum_bytes} bytes")
    try:
        decoded = json.loads(payload.decode("utf-8"), parse_constant=_reject_json_constant)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError("request must contain one UTF-8 JSON document") from error
    return require_object(cast(JsonValue, decoded), "request")


class JsonLineWriter:
    def __init__(
        self,
        stream: TextIO,
        maximum_message_bytes: int = MAXIMUM_PROTOCOL_MESSAGE_BYTES,
    ) -> None:
        self._stream = stream
        self._maximum_message_bytes = maximum_message_bytes

    def write_progress(self, progress: JsonValue) -> None:
        self._write({"kind": OperationMessageKind.PROGRESS, "progress": progress})

    def write_succeeded(self, result: JsonValue) -> None:
        self._write(
            {
                "kind": OperationMessageKind.TERMINAL,
                "terminal": {"status": ExecutionStatus.SUCCEEDED, "result": result},
            }
        )

    def write_failed(self, error: BackendError) -> None:
        failure: JsonObject = {
            "code": error.code,
            "message": str(error),
            "retryable": error.retryable,
        }
        if error.diagnostics is not None:
            failure["diagnostics"] = error.diagnostics
        self._write(
            {
                "kind": OperationMessageKind.TERMINAL,
                "terminal": {"status": ExecutionStatus.FAILED, "failure": failure},
            }
        )

    def write_cancelled(self, reason: JsonValue | None = None) -> None:
        terminal: JsonObject = {"status": ExecutionStatus.CANCELLED}
        if reason is not None:
            terminal["reason"] = reason
        self._write({"kind": OperationMessageKind.TERMINAL, "terminal": terminal})

    def write_completed_invocation(self, result: JsonValue) -> None:
        self._write({"kind": InvocationMessageKind.COMPLETED, "result": result})

    def write_stream_start(self) -> None:
        self._write({"kind": InvocationMessageKind.STREAM_START})

    def write_chunk(self, result: JsonValue) -> None:
        self._write({"kind": InvocationMessageKind.CHUNK, "result": result})

    def _write(self, message: JsonObject) -> None:
        encoded = json.dumps(
            message,
            ensure_ascii=False,
            allow_nan=False,
            separators=(",", ":"),
        )
        if len(encoded.encode("utf-8")) > self._maximum_message_bytes:
            raise ValueError(f"protocol message exceeds {self._maximum_message_bytes} bytes")
        self._stream.write(f"{encoded}\n")
        self._stream.flush()


def _reject_json_constant(value: str) -> None:
    raise ValueError(f"non-finite JSON number is not allowed: {value}")
