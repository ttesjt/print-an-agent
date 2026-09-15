from __future__ import annotations

from typing import cast

import torch
from torch import Tensor, nn
from torch.nn import functional as functional

from .contracts import TinyTransformerConfiguration


class CausalSelfAttention(nn.Module):
    def __init__(self, configuration: TinyTransformerConfiguration) -> None:
        super().__init__()
        self._heads = configuration.attention_heads
        self._head_dimension = configuration.embedding_dimension // configuration.attention_heads
        self._query_key_value = nn.Linear(
            configuration.embedding_dimension,
            3 * configuration.embedding_dimension,
            bias=False,
        )
        self._projection = nn.Linear(
            configuration.embedding_dimension,
            configuration.embedding_dimension,
            bias=False,
        )

    def forward(self, values: Tensor) -> Tensor:
        batch_size, sequence_length, channels = values.shape
        query_key_value = self._query_key_value(values)
        query, key, value = query_key_value.split(channels, dim=2)
        query = query.view(
            batch_size, sequence_length, self._heads, self._head_dimension
        ).transpose(1, 2)
        key = key.view(batch_size, sequence_length, self._heads, self._head_dimension).transpose(
            1, 2
        )
        value = value.view(
            batch_size, sequence_length, self._heads, self._head_dimension
        ).transpose(1, 2)
        attended = functional.scaled_dot_product_attention(
            query,
            key,
            value,
            is_causal=True,
        )
        merged = attended.transpose(1, 2).contiguous().view(batch_size, sequence_length, channels)
        return cast(Tensor, self._projection(merged))


class FeedForward(nn.Module):
    def __init__(self, configuration: TinyTransformerConfiguration) -> None:
        super().__init__()
        hidden_dimension = configuration.feed_forward_multiplier * configuration.embedding_dimension
        self._layers = nn.Sequential(
            nn.Linear(configuration.embedding_dimension, hidden_dimension, bias=False),
            nn.GELU(),
            nn.Linear(hidden_dimension, configuration.embedding_dimension, bias=False),
        )

    def forward(self, values: Tensor) -> Tensor:
        return cast(Tensor, self._layers(values))


class TransformerBlock(nn.Module):
    def __init__(self, configuration: TinyTransformerConfiguration) -> None:
        super().__init__()
        self._attention_normalization = nn.LayerNorm(configuration.embedding_dimension)
        self._attention = CausalSelfAttention(configuration)
        self._feed_forward_normalization = nn.LayerNorm(configuration.embedding_dimension)
        self._feed_forward = FeedForward(configuration)

    def forward(self, values: Tensor) -> Tensor:
        values = values + self._attention(self._attention_normalization(values))
        return cast(Tensor, values + self._feed_forward(self._feed_forward_normalization(values)))


class TinyTransformer(nn.Module):
    def __init__(self, configuration: TinyTransformerConfiguration) -> None:
        super().__init__()
        self.configuration = configuration
        self._token_embedding = nn.Embedding(
            configuration.vocabulary_size, configuration.embedding_dimension
        )
        self._position_embedding = nn.Embedding(
            configuration.context_length, configuration.embedding_dimension
        )
        self._blocks = nn.ModuleList(
            TransformerBlock(configuration) for _ in range(configuration.layers)
        )
        self._normalization = nn.LayerNorm(configuration.embedding_dimension)
        self._language_model_head = nn.Linear(
            configuration.embedding_dimension,
            configuration.vocabulary_size,
            bias=False,
        )
        self._language_model_head.weight = self._token_embedding.weight
        self.apply(self._initialize_weights)

    def forward(
        self, tokens: Tensor, targets: Tensor | None = None
    ) -> tuple[Tensor, Tensor | None]:
        _batch_size, sequence_length = tokens.shape
        if sequence_length > self.configuration.context_length:
            raise ValueError("input exceeds the configured context length")
        positions = torch.arange(sequence_length, device=tokens.device)
        values = self._token_embedding(tokens) + self._position_embedding(positions)
        for block in self._blocks:
            values = block(values)
        logits = self._language_model_head(self._normalization(values))
        if targets is None:
            return logits, None
        loss = functional.cross_entropy(
            logits.reshape(-1, logits.size(-1)),
            targets.reshape(-1),
        )
        return logits, loss

    @staticmethod
    def _initialize_weights(module: nn.Module) -> None:
        if isinstance(module, nn.Linear):
            nn.init.normal_(module.weight, mean=0.0, std=0.02)
            if module.bias is not None:
                nn.init.zeros_(module.bias)
        elif isinstance(module, nn.Embedding):
            nn.init.normal_(module.weight, mean=0.0, std=0.02)


def count_parameters(model: nn.Module) -> int:
    return sum(parameter.numel() for parameter in model.parameters())
