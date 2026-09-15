from __future__ import annotations

from collections.abc import Iterable

import torch

from ta_agent_model_backend.model.constants import MODEL_VOCABULARY, UNKNOWN_CHARACTER
from ta_agent_model_backend.model.contracts import TinyTransformerConfiguration, TorchRuntime
from ta_agent_model_backend.model.service import TinyTransformerService
from ta_agent_model_backend.model.text import CharacterCodec

MODEL_CONFIGURATION = TinyTransformerConfiguration(
    vocabulary_size=len(MODEL_VOCABULARY),
    context_length=8,
    embedding_dimension=12,
    attention_heads=3,
    layers=1,
    feed_forward_multiplier=2,
)
CPU_RUNTIME = TorchRuntime(device="cpu", dtype="float32")


def test_training_updates_real_parameters_and_reports_progress() -> None:
    service = TinyTransformerService()
    source = service.initialize(MODEL_CONFIGURATION, CPU_RUNTIME, seed=7)
    progress: list[object] = []

    trained = service.train(
        source,
        CPU_RUNTIME,
        steps=3,
        batch_size=2,
        learning_rate=0.01,
        seed=11,
        report_progress=progress.append,
        check_cancellation=lambda: None,
    )

    assert len(progress) == 3
    assert trained.steps == 3
    assert trained.initial_loss > 0
    assert trained.final_loss > 0
    assert any(
        not torch.equal(source.state[name], trained.checkpoint.state[name]) for name in source.state
    )


def test_exported_model_generates_the_same_completed_and_streaming_text() -> None:
    service = TinyTransformerService()
    checkpoint = service.initialize(MODEL_CONFIGURATION, CPU_RUNTIME, seed=7)
    exported = service.export(checkpoint)

    def generate() -> Iterable[str]:
        return service.generate(
            exported,
            CPU_RUNTIME,
            prompt="hello",
            maximum_new_tokens=4,
            check_cancellation=lambda: None,
        )

    completed = "".join(generate())
    streamed = list(generate())

    assert len(completed) == 4
    assert "".join(streamed) == completed
    assert all(len(chunk) == 1 for chunk in streamed)


def test_tokenizer_maps_unseen_unicode_to_an_explicit_unknown_token() -> None:
    codec = CharacterCodec(MODEL_VOCABULARY, UNKNOWN_CHARACTER)

    assert codec.decode(codec.encode("Hello 123 你好")) == "�ello ��� ��"
