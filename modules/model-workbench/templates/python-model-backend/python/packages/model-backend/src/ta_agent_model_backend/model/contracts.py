from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, TypeAlias

from .constants import (
    MAXIMUM_ATTENTION_HEADS,
    MAXIMUM_CONTEXT_LENGTH,
    MAXIMUM_EMBEDDING_DIMENSION,
    MAXIMUM_FEED_FORWARD_MULTIPLIER,
    MAXIMUM_LAYERS,
    MAXIMUM_VOCABULARY_SIZE,
    MINIMUM_CONTEXT_LENGTH,
    MINIMUM_EMBEDDING_DIMENSION,
)

if TYPE_CHECKING:
    from torch import Tensor

TensorState: TypeAlias = "dict[str, Tensor]"


@dataclass(frozen=True, slots=True)
class TinyTransformerConfiguration:
    vocabulary_size: int
    context_length: int
    embedding_dimension: int
    attention_heads: int
    layers: int
    feed_forward_multiplier: int

    def __post_init__(self) -> None:
        bounded_values = {
            "vocabulary_size": (self.vocabulary_size, 1, MAXIMUM_VOCABULARY_SIZE),
            "context_length": (
                self.context_length,
                MINIMUM_CONTEXT_LENGTH,
                MAXIMUM_CONTEXT_LENGTH,
            ),
            "embedding_dimension": (
                self.embedding_dimension,
                MINIMUM_EMBEDDING_DIMENSION,
                MAXIMUM_EMBEDDING_DIMENSION,
            ),
            "attention_heads": (self.attention_heads, 1, MAXIMUM_ATTENTION_HEADS),
            "layers": (self.layers, 1, MAXIMUM_LAYERS),
            "feed_forward_multiplier": (
                self.feed_forward_multiplier,
                1,
                MAXIMUM_FEED_FORWARD_MULTIPLIER,
            ),
        }
        for name, (value, minimum, maximum) in bounded_values.items():
            if value < minimum or value > maximum:
                raise ValueError(f"{name} must be between {minimum} and {maximum}")
        if self.embedding_dimension % self.attention_heads != 0:
            raise ValueError("embedding_dimension must be divisible by attention_heads")


@dataclass(frozen=True, slots=True)
class ModelCheckpoint:
    configuration: TinyTransformerConfiguration
    vocabulary: str
    state: TensorState
    parameter_count: int


@dataclass(frozen=True, slots=True)
class ExportedModel:
    configuration: TinyTransformerConfiguration
    vocabulary: str
    state: TensorState
    parameter_count: int


@dataclass(frozen=True, slots=True)
class TrainingProgress:
    step: int
    total_steps: int
    loss: float


@dataclass(frozen=True, slots=True)
class TrainingResult:
    checkpoint: ModelCheckpoint
    steps: int
    initial_loss: float
    final_loss: float


@dataclass(frozen=True, slots=True)
class TorchRuntime:
    device: str
    dtype: str
