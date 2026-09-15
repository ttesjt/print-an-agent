from __future__ import annotations

import sys
from collections.abc import Iterator

from ta_agent_model_backend.infrastructure.cli import run_backend_cli
from ta_agent_model_backend.infrastructure.contracts import (
    BackendHandlers,
    CancellationToken,
    CompletedInvocation,
    OperationContext,
    StreamingInvocation,
)
from ta_agent_model_backend.infrastructure.errors import BackendError, BackendErrorCode
from ta_agent_model_backend.infrastructure.json_values import (
    JsonObject,
    JsonValue,
    require_boolean,
    require_object,
    require_string,
)

SCENARIO_BACKEND_FAILURE = "backend-failure"
SCENARIO_CANCELLED = "cancelled"
SCENARIO_STREAM_FAILURE = "stream-failure"
SCENARIO_UNEXPECTED_FAILURE = "unexpected-failure"


def _operate(request: JsonObject, context: OperationContext) -> JsonObject:
    operation_input = require_object(request.get("input"), "request.input")
    scenario = _scenario(operation_input)
    if scenario == SCENARIO_BACKEND_FAILURE:
        raise BackendError(
            BackendErrorCode.OPERATION_FAILED,
            "Planned backend failure.",
            retryable=True,
            diagnostics={"source": "fixture"},
        )
    if scenario == SCENARIO_CANCELLED:
        context.cancellation.cancel()
        context.cancellation.raise_if_cancelled()
    if scenario == SCENARIO_UNEXPECTED_FAILURE:
        raise RuntimeError("planned unexpected failure")
    context.report_progress({"step": 1, "totalSteps": 1})
    return {"received": operation_input}


def _invoke(
    request: JsonObject,
    cancellation: CancellationToken,
) -> CompletedInvocation | StreamingInvocation:
    cancellation.raise_if_cancelled()
    invocation_input = require_object(request.get("input"), "request.input")
    scenario = _scenario(invocation_input)
    if scenario == SCENARIO_UNEXPECTED_FAILURE:
        raise RuntimeError("planned invocation failure")
    stream = require_boolean(invocation_input.get("stream"), "request.input.stream")
    if stream:
        if scenario == SCENARIO_STREAM_FAILURE:
            return StreamingInvocation(_failing_stream())
        return StreamingInvocation({"text": value} for value in ("a", "b"))
    return CompletedInvocation({"text": "ab"})


def _scenario(value: JsonObject) -> str | None:
    scenario = value.get("scenario")
    return None if scenario is None else require_string(scenario, "request.input.scenario")


def _failing_stream() -> Iterator[JsonValue]:
    yield {"text": "a"}
    raise RuntimeError("planned streaming failure")


def main() -> int:
    handlers = BackendHandlers(
        initialize=_operate,
        train=_operate,
        export=_operate,
        invoke=_invoke,
    )
    return run_backend_cli(sys.argv[1:], handlers)


if __name__ == "__main__":
    raise SystemExit(main())
