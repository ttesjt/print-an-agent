from __future__ import annotations

from collections.abc import Iterable

from ....infrastructure.contracts import (
    CancellationToken,
    CompletedInvocation,
    InvocationHandler,
    StreamingInvocation,
)
from ....infrastructure.json_values import JsonObject, JsonValue
from ....model.contracts import TorchRuntime
from ....model.service import TinyTransformerService
from ...model_io import read_output_model
from .contracts import create_invocation_output, parse_invocation_input


def create_invocation_handler(
    model: TinyTransformerService,
    runtime: TorchRuntime,
) -> InvocationHandler:
    def invoke(
        request: JsonObject,
        cancellation: CancellationToken,
    ) -> CompletedInvocation | StreamingInvocation:
        parsed = parse_invocation_input(request)
        exported = read_output_model(request)
        cancellation.raise_if_cancelled()

        def generated_text() -> Iterable[str]:
            return model.generate(
                exported,
                runtime,
                prompt=parsed.prompt,
                maximum_new_tokens=parsed.maximum_new_tokens,
                check_cancellation=cancellation.raise_if_cancelled,
            )

        if not parsed.stream:
            return CompletedInvocation(create_invocation_output("".join(generated_text())))

        def chunks() -> Iterable[JsonValue]:
            for text in generated_text():
                yield create_invocation_output(text)

        return StreamingInvocation(chunks())

    return invoke
