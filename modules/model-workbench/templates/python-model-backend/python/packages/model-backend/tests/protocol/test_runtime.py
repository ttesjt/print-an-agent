from __future__ import annotations

import io
import json

from ta_agent_model_backend.infrastructure.constants import BackendCommand
from ta_agent_model_backend.infrastructure.contracts import (
    BackendHandlers,
    CompletedInvocation,
    InvocationHandler,
    OperationContext,
    OperationHandler,
    StreamingInvocation,
)
from ta_agent_model_backend.infrastructure.json_values import JsonObject
from ta_agent_model_backend.infrastructure.runtime import run_command


def test_operation_uses_progress_and_terminal_protocol() -> None:
    def operation(request: JsonObject, context: OperationContext) -> JsonObject:
        context.report_progress({"step": 1})
        return {"received": request["input"]}

    output = io.StringIO()
    code = run_command(
        BackendCommand.INITIALIZE,
        _handlers(operation=operation),
        io.BytesIO(_request("initialization")),
        output,
        io.StringIO(),
    )

    assert code == 0
    assert [json.loads(line) for line in output.getvalue().splitlines()] == [
        {"kind": "progress", "progress": {"step": 1}},
        {
            "kind": "terminal",
            "terminal": {
                "status": "succeeded",
                "result": {"received": {"value": 1}},
            },
        },
    ]


def test_operation_turns_invalid_request_into_structured_failure() -> None:
    output = io.StringIO()
    code = run_command(
        BackendCommand.TRAIN,
        _handlers(),
        io.BytesIO(_request("initialization")),
        output,
        io.StringIO(),
    )

    assert code == 0
    terminal = json.loads(output.getvalue())["terminal"]
    assert terminal["status"] == "failed"
    assert terminal["failure"]["code"] == "BACKEND_INVALID_REQUEST"


def test_operation_rejects_non_finite_json_numbers() -> None:
    output = io.StringIO()
    code = run_command(
        BackendCommand.INITIALIZE,
        _handlers(),
        io.BytesIO(b'{"operation":"initialization","value":NaN}'),
        output,
        io.StringIO(),
    )

    assert code == 0
    terminal = json.loads(output.getvalue())["terminal"]
    assert terminal["status"] == "failed"
    assert terminal["failure"]["code"] == "BACKEND_INVALID_REQUEST"


def test_invocation_supports_completed_and_streaming_results() -> None:
    completed_output = io.StringIO()
    completed_code = run_command(
        BackendCommand.INVOKE,
        _handlers(invoke=lambda _request, _cancellation: CompletedInvocation({"text": "done"})),
        io.BytesIO(b"{}"),
        completed_output,
        io.StringIO(),
    )
    assert completed_code == 0
    assert json.loads(completed_output.getvalue()) == {
        "kind": "completed",
        "result": {"text": "done"},
    }

    streaming_output = io.StringIO()
    streaming_code = run_command(
        BackendCommand.INVOKE,
        _handlers(
            invoke=lambda _request, _cancellation: StreamingInvocation(
                {"text": value} for value in ("a", "b")
            )
        ),
        io.BytesIO(b"{}"),
        streaming_output,
        io.StringIO(),
    )
    assert streaming_code == 0
    assert [json.loads(line) for line in streaming_output.getvalue().splitlines()] == [
        {"kind": "stream-start"},
        {"kind": "chunk", "result": {"text": "a"}},
        {"kind": "chunk", "result": {"text": "b"}},
    ]


def _request(operation: str) -> bytes:
    return json.dumps(
        {"operation": operation, "profileId": "profile", "runId": "run", "input": {"value": 1}}
    ).encode()


def _handlers(
    *,
    operation: OperationHandler | None = None,
    invoke: InvocationHandler | None = None,
) -> BackendHandlers:
    selected_operation: OperationHandler = operation or (lambda _request, _context: {})
    selected_invocation: InvocationHandler = invoke or (
        lambda _request, _cancellation: CompletedInvocation({"ok": True})
    )
    return BackendHandlers(
        initialize=selected_operation,
        train=selected_operation,
        export=selected_operation,
        invoke=selected_invocation,
    )
