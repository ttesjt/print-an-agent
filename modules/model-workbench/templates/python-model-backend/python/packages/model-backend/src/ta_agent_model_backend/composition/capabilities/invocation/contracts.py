from __future__ import annotations

from dataclasses import dataclass

from ....infrastructure.json_values import (
    JsonObject,
    require_boolean,
    require_integer,
    require_object,
    require_string,
)
from ....model.constants import MAXIMUM_NEW_TOKENS


@dataclass(frozen=True, slots=True)
class InvocationInput:
    prompt: str
    maximum_new_tokens: int
    stream: bool


def parse_invocation_input(request: JsonObject) -> InvocationInput:
    value = require_object(request.get("input"), "request.input")
    return InvocationInput(
        prompt=require_string(value.get("prompt"), "request.input.prompt"),
        maximum_new_tokens=require_integer(
            value.get("maxNewTokens"),
            "request.input.maxNewTokens",
            minimum=1,
            maximum=MAXIMUM_NEW_TOKENS,
        ),
        stream=require_boolean(value.get("stream"), "request.input.stream"),
    )


def create_invocation_output(text: str) -> JsonObject:
    return {"text": text}
