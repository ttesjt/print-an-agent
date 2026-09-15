from __future__ import annotations

from dataclasses import dataclass

from ....infrastructure.json_values import JsonObject, require_integer, require_object
from ....model.constants import (
    MAXIMUM_ATTENTION_HEADS,
    MAXIMUM_CONTEXT_LENGTH,
    MAXIMUM_EMBEDDING_DIMENSION,
    MAXIMUM_FEED_FORWARD_MULTIPLIER,
    MAXIMUM_LAYERS,
    MINIMUM_CONTEXT_LENGTH,
    MINIMUM_EMBEDDING_DIMENSION,
    MODEL_VOCABULARY,
)
from ....model.contracts import ModelCheckpoint, TinyTransformerConfiguration, TorchRuntime
from ..common import parse_seed


@dataclass(frozen=True, slots=True)
class InitializationInput:
    model: TinyTransformerConfiguration
    seed: int


def parse_initialization_input(value: JsonObject) -> InitializationInput:
    return InitializationInput(
        model=_parse_model_configuration(require_object(value.get("model"), "request.input.model")),
        seed=parse_seed(value.get("seed"), "request.input.seed"),
    )


def create_initialization_result_data(
    checkpoint: ModelCheckpoint,
    runtime: TorchRuntime,
) -> JsonObject:
    return {
        "parameterCount": checkpoint.parameter_count,
        "device": runtime.device,
        "dtype": runtime.dtype,
    }


def _parse_model_configuration(value: JsonObject) -> TinyTransformerConfiguration:
    return TinyTransformerConfiguration(
        vocabulary_size=len(MODEL_VOCABULARY),
        context_length=require_integer(
            value.get("contextLength"),
            "request.input.model.contextLength",
            minimum=MINIMUM_CONTEXT_LENGTH,
            maximum=MAXIMUM_CONTEXT_LENGTH,
        ),
        embedding_dimension=require_integer(
            value.get("embeddingDimension"),
            "request.input.model.embeddingDimension",
            minimum=MINIMUM_EMBEDDING_DIMENSION,
            maximum=MAXIMUM_EMBEDDING_DIMENSION,
        ),
        attention_heads=require_integer(
            value.get("attentionHeads"),
            "request.input.model.attentionHeads",
            minimum=1,
            maximum=MAXIMUM_ATTENTION_HEADS,
        ),
        layers=require_integer(
            value.get("layers"),
            "request.input.model.layers",
            minimum=1,
            maximum=MAXIMUM_LAYERS,
        ),
        feed_forward_multiplier=require_integer(
            value.get("feedForwardMultiplier"),
            "request.input.model.feedForwardMultiplier",
            minimum=1,
            maximum=MAXIMUM_FEED_FORWARD_MULTIPLIER,
        ),
    )
