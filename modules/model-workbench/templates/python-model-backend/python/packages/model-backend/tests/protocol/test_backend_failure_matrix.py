from __future__ import annotations

import sys
from pathlib import Path

import pytest

from backend_testkit import BackendProcess, BackendProtocolOutputError
from ta_agent_model_backend.infrastructure.constants import BackendCommand
from ta_agent_model_backend.infrastructure.json_values import JsonObject

PACKAGE_ROOT = Path(__file__).parents[2]
FIXTURE_DIRECTORY = PACKAGE_ROOT / "tests" / "fixtures"
SOURCE_DIRECTORY = PACKAGE_ROOT / "src"


def test_backend_failure_preserves_retry_and_diagnostics() -> None:
    result = _fake_backend().run(
        BackendCommand.TRAIN,
        _operation_request("training", {"scenario": "backend-failure"}),
    )

    assert result.return_code == 0
    assert result.stderr == ""
    assert result.messages == (
        {
            "kind": "terminal",
            "terminal": {
                "status": "failed",
                "failure": {
                    "code": "BACKEND_OPERATION_FAILED",
                    "message": "Planned backend failure.",
                    "retryable": True,
                    "diagnostics": {"source": "fixture"},
                },
            },
        },
    )


def test_unexpected_operation_failure_is_structured_and_diagnosable() -> None:
    result = _fake_backend().run(
        BackendCommand.EXPORT,
        _operation_request("export", {"scenario": "unexpected-failure"}),
    )

    assert result.return_code == 0
    assert "RuntimeError: planned unexpected failure" in result.stderr
    failure = result.messages[0]["terminal"]
    assert isinstance(failure, dict)
    assert failure == {
        "status": "failed",
        "failure": {
            "code": "BACKEND_OPERATION_FAILED",
            "message": "Backend operation failed unexpectedly.",
            "retryable": False,
            "diagnostics": {"exceptionType": "RuntimeError"},
        },
    }


def test_cancelled_operation_uses_a_distinct_terminal_status() -> None:
    result = _fake_backend().run(
        BackendCommand.INITIALIZE,
        _operation_request("initialization", {"scenario": "cancelled"}),
    )

    assert result.return_code == 0
    assert result.messages == (
        {
            "kind": "terminal",
            "terminal": {
                "status": "cancelled",
                "reason": "Backend execution was cancelled.",
            },
        },
    )


def test_invocation_failure_uses_process_failure_semantics() -> None:
    result = _fake_backend().run(
        BackendCommand.INVOKE,
        {"input": {"stream": False, "scenario": "unexpected-failure"}},
    )

    assert result.return_code == 1
    assert result.messages == ()
    assert "RuntimeError: planned invocation failure" in result.stderr


def test_stream_failure_preserves_valid_prefix_and_fails_the_process() -> None:
    result = _fake_backend().run(
        BackendCommand.INVOKE,
        {"input": {"stream": True, "scenario": "stream-failure"}},
    )

    assert result.return_code == 1
    assert result.messages == (
        {"kind": "stream-start"},
        {"kind": "chunk", "result": {"text": "a"}},
    )
    assert "RuntimeError: planned streaming failure" in result.stderr


def test_invalid_operation_identity_becomes_a_request_failure() -> None:
    result = _fake_backend().run(
        BackendCommand.TRAIN,
        _operation_request("initialization", {}),
    )

    assert result.return_code == 0
    terminal = result.messages[0]["terminal"]
    assert isinstance(terminal, dict)
    failure = terminal["failure"]
    assert isinstance(failure, dict)
    assert failure["code"] == "BACKEND_INVALID_REQUEST"


def test_harness_rejects_malformed_protocol_output() -> None:
    backend = BackendProcess((sys.executable, str(FIXTURE_DIRECTORY / "malformed_backend_cli.py")))

    with pytest.raises(BackendProtocolOutputError, match="line 1"):
        backend.run(BackendCommand.INITIALIZE, {})


def _fake_backend() -> BackendProcess:
    return BackendProcess(
        (sys.executable, str(FIXTURE_DIRECTORY / "fake_backend_cli.py")),
        environment={"PYTHONPATH": str(SOURCE_DIRECTORY)},
    )


def _operation_request(operation: str, operation_input: JsonObject) -> JsonObject:
    return {
        "operation": operation,
        "profileId": "profile",
        "runId": "run",
        "input": operation_input,
    }
