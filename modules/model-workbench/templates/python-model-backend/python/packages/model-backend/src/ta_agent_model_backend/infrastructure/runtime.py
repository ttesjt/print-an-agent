from __future__ import annotations

import signal
import sys
import traceback
from collections.abc import Callable, Iterator, Sequence
from contextlib import contextmanager
from types import FrameType
from typing import BinaryIO, TextIO

from .constants import BackendCommand, ModelOperation
from .contracts import (
    BackendHandlers,
    CancellationToken,
    CompletedInvocation,
    InvocationHandler,
    OperationContext,
    OperationHandler,
    StreamingInvocation,
)
from .errors import BackendCancelledError, BackendError, BackendErrorCode
from .json_values import JsonObject
from .protocol import JsonLineWriter, read_request

_COMMAND_OPERATIONS = {
    BackendCommand.INITIALIZE: ModelOperation.INITIALIZATION,
    BackendCommand.TRAIN: ModelOperation.TRAINING,
    BackendCommand.EXPORT: ModelOperation.EXPORT,
}


def run_operation(
    command: BackendCommand,
    handler: OperationHandler,
    input_stream: BinaryIO,
    output_stream: TextIO,
    error_stream: TextIO,
) -> int:
    writer = JsonLineWriter(output_stream)
    cancellation = CancellationToken()
    try:
        with _signal_cancellation(cancellation):
            request = read_request(input_stream)
            _validate_operation(request, _COMMAND_OPERATIONS[command])
            context = OperationContext(writer.write_progress, cancellation)
            result = handler(request, context)
            cancellation.raise_if_cancelled()
            writer.write_succeeded(result)
    except BackendCancelledError as error:
        writer.write_cancelled(str(error))
    except BackendError as error:
        writer.write_failed(error)
    except (KeyError, TypeError, ValueError) as error:
        writer.write_failed(
            BackendError(BackendErrorCode.INVALID_REQUEST, str(error), retryable=False)
        )
    except Exception as error:  # noqa: BLE001 - process boundary must emit a terminal result
        traceback.print_exc(file=error_stream)
        writer.write_failed(
            BackendError(
                BackendErrorCode.OPERATION_FAILED,
                "Backend operation failed unexpectedly.",
                retryable=False,
                diagnostics={"exceptionType": type(error).__name__},
            )
        )
    return 0


def run_invocation(
    handler: InvocationHandler,
    input_stream: BinaryIO,
    output_stream: TextIO,
    error_stream: TextIO,
) -> int:
    writer = JsonLineWriter(output_stream)
    cancellation = CancellationToken()
    try:
        with _signal_cancellation(cancellation):
            request = read_request(input_stream)
            result = handler(request, cancellation)
            cancellation.raise_if_cancelled()
            if isinstance(result, CompletedInvocation):
                writer.write_completed_invocation(result.result)
                return 0
            if not isinstance(result, StreamingInvocation):
                raise TypeError("invocation handler returned an unsupported result")
            writer.write_stream_start()
            for chunk in result.chunks:
                cancellation.raise_if_cancelled()
                writer.write_chunk(chunk)
        return 0
    except Exception:  # noqa: BLE001 - invocation failure is signalled by process exit
        traceback.print_exc(file=error_stream)
        return 1


def run_command(
    command: BackendCommand,
    handlers: BackendHandlers,
    input_stream: BinaryIO,
    output_stream: TextIO,
    error_stream: TextIO,
) -> int:
    if command is BackendCommand.INVOKE:
        return run_invocation(handlers.invoke, input_stream, output_stream, error_stream)
    handler = _operation_handler(command, handlers)
    return run_operation(command, handler, input_stream, output_stream, error_stream)


def parse_command(arguments: Sequence[str]) -> BackendCommand:
    if len(arguments) != 1:
        raise ValueError("exactly one command is required")
    try:
        return BackendCommand(arguments[0])
    except ValueError as error:
        choices = ", ".join(command.value for command in BackendCommand)
        raise ValueError(f"command must be one of: {choices}") from error


def _operation_handler(command: BackendCommand, handlers: BackendHandlers) -> OperationHandler:
    if command is BackendCommand.INITIALIZE:
        return handlers.initialize
    if command is BackendCommand.TRAIN:
        return handlers.train
    if command is BackendCommand.EXPORT:
        return handlers.export
    raise ValueError(f"{command.value} is not a detached model operation")


def _validate_operation(request: JsonObject, expected: ModelOperation) -> None:
    operation = request.get("operation")
    if operation != expected:
        raise ValueError(f"request.operation must equal {expected.value}")


@contextmanager
def _signal_cancellation(cancellation: CancellationToken) -> Iterator[None]:
    handler_type = Callable[[int, FrameType | None], object] | int | None
    previous_handlers: dict[signal.Signals, handler_type] = {}

    def request_cancellation(_signum: int, _frame: FrameType | None) -> None:
        cancellation.cancel()

    for name in ("SIGINT", "SIGTERM"):
        current = getattr(signal, name, None)
        if current is None:
            continue
        previous_handlers[current] = signal.getsignal(current)
        signal.signal(current, request_cancellation)
    try:
        yield
    finally:
        for current, previous in previous_handlers.items():
            signal.signal(current, previous)


def default_streams() -> tuple[BinaryIO, TextIO, TextIO]:
    return sys.stdin.buffer, sys.stdout, sys.stderr
