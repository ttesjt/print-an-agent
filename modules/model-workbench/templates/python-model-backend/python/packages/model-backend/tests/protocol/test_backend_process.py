from __future__ import annotations

import sys
from pathlib import Path

from backend_testkit import BackendProcess
from ta_agent_model_backend.infrastructure.constants import BackendCommand
from ta_agent_model_backend.infrastructure.json_values import JsonObject

PACKAGE_ROOT = Path(__file__).parents[2]
FAKE_BACKEND = PACKAGE_ROOT / "tests" / "fixtures" / "fake_backend_cli.py"
SOURCE_DIRECTORY = PACKAGE_ROOT / "src"


def test_process_harness_observes_operation_messages() -> None:
    result = _backend().run(
        BackendCommand.INITIALIZE,
        {
            "operation": "initialization",
            "profileId": "profile",
            "runId": "run",
            "input": {"value": 1},
        },
    )

    assert result.return_code == 0
    assert result.stderr == ""
    assert result.messages == (
        {"kind": "progress", "progress": {"step": 1, "totalSteps": 1}},
        {
            "kind": "terminal",
            "terminal": {
                "status": "succeeded",
                "result": {"received": {"value": 1}},
            },
        },
    )


def test_each_detached_operation_uses_the_same_message_protocol() -> None:
    for command, operation in (
        (BackendCommand.INITIALIZE, "initialization"),
        (BackendCommand.TRAIN, "training"),
        (BackendCommand.EXPORT, "export"),
    ):
        result = _backend().run(
            command,
            {
                "operation": operation,
                "profileId": "profile",
                "runId": f"run:{operation}",
                "input": {"operation": operation},
            },
        )

        assert result.return_code == 0
        assert result.messages[-1] == {
            "kind": "terminal",
            "terminal": {
                "status": "succeeded",
                "result": {"received": {"operation": operation}},
            },
        }


def test_process_harness_observes_streaming_invocation() -> None:
    result = _backend().run(BackendCommand.INVOKE, {"input": {"stream": True}})

    assert result.return_code == 0
    assert result.stderr == ""
    assert result.messages == (
        {"kind": "stream-start"},
        {"kind": "chunk", "result": {"text": "a"}},
        {"kind": "chunk", "result": {"text": "b"}},
    )


def test_completed_and_streaming_invocation_are_semantically_equal() -> None:
    completed = _backend().run(BackendCommand.INVOKE, {"input": {"stream": False}})
    streaming = _backend().run(BackendCommand.INVOKE, {"input": {"stream": True}})

    assert completed.messages == ({"kind": "completed", "result": {"text": "ab"}},)
    assert "".join(_chunk_texts(streaming.messages)) == "ab"


def _backend() -> BackendProcess:
    return BackendProcess(
        (sys.executable, str(FAKE_BACKEND)),
        environment={"PYTHONPATH": str(SOURCE_DIRECTORY)},
    )


def _chunk_texts(messages: tuple[JsonObject, ...]) -> list[str]:
    texts: list[str] = []
    for message in messages:
        if message.get("kind") != "chunk":
            continue
        result = message.get("result")
        assert isinstance(result, dict)
        text = result.get("text")
        assert isinstance(text, str)
        texts.append(text)
    return texts
