from __future__ import annotations

from collections.abc import Callable, Iterable
from dataclasses import dataclass
from threading import Event
from typing import Protocol, TypeAlias

from .errors import BackendCancelledError
from .json_values import JsonObject, JsonValue

ProgressReporter: TypeAlias = Callable[[JsonValue], None]


class CancellationToken:
    def __init__(self) -> None:
        self._cancelled = Event()

    @property
    def is_cancelled(self) -> bool:
        return self._cancelled.is_set()

    def cancel(self) -> None:
        self._cancelled.set()

    def raise_if_cancelled(self) -> None:
        if self.is_cancelled:
            raise BackendCancelledError()


@dataclass(frozen=True, slots=True)
class OperationContext:
    report_progress: ProgressReporter
    cancellation: CancellationToken


class OperationHandler(Protocol):
    def __call__(self, request: JsonObject, context: OperationContext) -> JsonObject: ...


@dataclass(frozen=True, slots=True)
class CompletedInvocation:
    result: JsonValue


@dataclass(frozen=True, slots=True)
class StreamingInvocation:
    chunks: Iterable[JsonValue]


InvocationResult: TypeAlias = CompletedInvocation | StreamingInvocation


class InvocationHandler(Protocol):
    def __call__(
        self, request: JsonObject, cancellation: CancellationToken
    ) -> InvocationResult: ...


@dataclass(frozen=True, slots=True)
class BackendHandlers:
    initialize: OperationHandler
    train: OperationHandler
    export: OperationHandler
    invoke: InvocationHandler
